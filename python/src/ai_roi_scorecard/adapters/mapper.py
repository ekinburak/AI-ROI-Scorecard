from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Literal

from ..models import (
    MAX_INPUT_INTEGER,
    AttemptFinishedEvent,
    AttemptStartedEvent,
    EvidenceEvent,
    ExceptionRecordedEvent,
    OutcomeCompletedEvent,
    _elapsed_ms,
    _validate_iso_datetime,
)
from .safety import (
    ROI_SEMANTIC_ATTRIBUTES,
    read_semantic_number,
    read_semantic_string,
)
from .types import DurationMode, NormalizedTelemetrySpan, TelemetryMapping


def _event_id(span_id: str, suffix: str) -> str:
    return f"{span_id}:{suffix}"


def _resolve(
    span: NormalizedTelemetrySpan,
    semantic_key: str,
    resolver: Callable[[NormalizedTelemetrySpan], object | None] | None,
) -> str | None:
    semantic = read_semantic_string(span.attributes, semantic_key)
    if semantic is not None:
        return semantic
    if resolver is None:
        return None
    value = resolver(span)
    return None if value is None else str(value)


def _map_status(status: str) -> Literal["succeeded", "failed", "abandoned"]:
    if status == "ok":
        return "succeeded"
    if status == "error":
        return "failed"
    return "abandoned"


def _resolve_duration_ms(span: NormalizedTelemetrySpan, duration_mode: DurationMode) -> int | None:
    if duration_mode == "omit":
        return None
    if span.duration_ms is not None:
        if isinstance(span.duration_ms, bool) or not isinstance(span.duration_ms, int) or not 0 <= span.duration_ms <= MAX_INPUT_INTEGER:
            raise ValueError("Invalid span duration")
        return span.duration_ms
    if span.ended_at is not None:
        return _elapsed_ms(span.started_at, span.ended_at)
    return None


class TelemetryEvidenceMapper:
    def __init__(self, mapping: TelemetryMapping) -> None:
        self._mapping = mapping

    def map_span(self, span: NormalizedTelemetrySpan) -> list[EvidenceEvent]:
        workflow_key = _resolve(
            span,
            ROI_SEMANTIC_ATTRIBUTES["workflow_key"],
            self._mapping.workflow_key,
        )
        policy_key = _resolve(
            span,
            ROI_SEMANTIC_ATTRIBUTES["policy_key"],
            self._mapping.policy_key,
        )
        account_id = read_semantic_string(
            span.attributes,
            ROI_SEMANTIC_ATTRIBUTES["account_id"],
        ) or self._mapping.account_id

        if not workflow_key or not policy_key or not account_id:
            return []

        _validate_iso_datetime(span.started_at)
        if span.ended_at is None:
            raise ValueError("Mapped work requires a completion timestamp")
        _validate_iso_datetime(span.ended_at)
        if datetime.fromisoformat(span.ended_at.replace("Z", "+00:00")) < datetime.fromisoformat(span.started_at.replace("Z", "+00:00")):
            raise ValueError("Completion precedes start")
        duration_mode = self._mapping.duration_mode
        if duration_mode not in {"span", "omit"}:
            raise ValueError("Invalid duration mode")
        duration_ms = _resolve_duration_ms(span, duration_mode)
        if duration_mode == "span" and duration_ms is None:
            return []

        base = {
            "account_id": account_id,
            "run_id": span.trace_id,
            "attempt_id": span.source_id,
            "workflow_key": workflow_key,
            "policy_key": policy_key,
        }
        events: list[EvidenceEvent] = [
            AttemptStartedEvent(
                event_id=_event_id(span.source_id, "started"),
                occurred_at=span.started_at,
                **base,
            )
        ]

        finished_at = span.ended_at or span.started_at
        attempt_status = _map_status(span.status)
        events.append(
            AttemptFinishedEvent(
                event_id=_event_id(span.source_id, "finished"),
                occurred_at=finished_at,
                status=attempt_status,
                active_duration_ms=duration_ms,
                **base,
            )
        )

        if attempt_status != "succeeded":
            category = _resolve(span, "exception.category", self._mapping.exception_category) or "TelemetryError"
            events.append(
                ExceptionRecordedEvent(
                    event_id=_event_id(span.source_id, "exception"),
                    occurred_at=finished_at,
                    exception_id=_event_id(span.source_id, "exception"),
                    category=category,
                    **base,
                )
            )
            return events

        should_record = (
            self._mapping.record_outcome(span)
            if self._mapping.record_outcome is not None
            else attempt_status == "succeeded"
            and _resolve(
                span,
                ROI_SEMANTIC_ATTRIBUTES["outcome_id"],
                self._mapping.outcome_id,
            )
            is not None
        )
        if not should_record:
            return events

        outcome_id = _resolve(
            span,
            ROI_SEMANTIC_ATTRIBUTES["outcome_id"],
            self._mapping.outcome_id,
        )
        if not outcome_id:
            return events

        units = read_semantic_number(span.attributes, ROI_SEMANTIC_ATTRIBUTES["units"])
        if units is None and self._mapping.units is not None:
            units = self._mapping.units(span)
        if units is None:
            units = 1
        if isinstance(units, bool) or not isinstance(units, int) or not 1 <= units <= MAX_INPUT_INTEGER:
            raise ValueError("Units must be a positive bounded integer")
        events.append(
            OutcomeCompletedEvent(
                event_id=_event_id(span.source_id, "outcome"),
                occurred_at=finished_at,
                outcome_id=outcome_id,
                units=units,
                **base,
            )
        )
        return events

    def map_spans(self, spans: list[NormalizedTelemetrySpan]) -> list[EvidenceEvent]:
        mapped: list[EvidenceEvent] = []
        for span in spans:
            mapped.extend(self.map_span(span))
        return mapped
