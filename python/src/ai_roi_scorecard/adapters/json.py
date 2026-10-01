from __future__ import annotations

from datetime import datetime
from typing import cast

from ..models import _elapsed_ms, _validate_iso_datetime
from .safety import sanitize_attributes
from .types import JsonTelemetryRecord, NormalizedTelemetrySpan, TelemetrySpanStatus


def _normalize_status(status: TelemetrySpanStatus | None) -> TelemetrySpanStatus:
    if status in {"ok", "error", "unset"}:
        return status
    return "unset"


def _compute_duration_ms(record: JsonTelemetryRecord) -> int | None:
    if record.ended_at is None:
        return None
    delta = _elapsed_ms(record.started_at, record.ended_at)
    return max(0, delta) if delta >= 0 else None


def parse_json_records(
    records: list[JsonTelemetryRecord | dict[str, object]],
    source: str = "json",
) -> list[NormalizedTelemetrySpan]:
    if not isinstance(records, list):
        raise ValueError("JSON telemetry must be an array")
    spans: list[NormalizedTelemetrySpan] = []
    for raw in records:
        if isinstance(raw, JsonTelemetryRecord):
            record = raw
        else:
            if not isinstance(raw, dict):
                raise ValueError("Records must be objects")
            for key in ["id", "name", "startedAt"]:
                if not isinstance(raw.get(key), str) or not raw[key]:
                    raise ValueError(f"Records require a string {key}")
            for key in ["traceId", "endedAt"]:
                if key in raw and not isinstance(raw[key], str):
                    raise ValueError(f"Invalid {key}")
            record = JsonTelemetryRecord(
                id=cast(str, raw["id"]), name=cast(str, raw["name"]),
                started_at=cast(str, raw["startedAt"]),
                trace_id=cast(str | None, raw.get("traceId")),
                ended_at=cast(str | None, raw.get("endedAt")),
                status=cast(TelemetrySpanStatus | None, raw.get("status")),
                attributes=cast(dict[str, str | int | float | bool] | None, raw.get("attributes")),
            )
        if record.status is not None and record.status not in {"ok", "error", "unset"}:
            raise ValueError("Invalid status")
        if record.attributes is not None and (not isinstance(record.attributes, dict) or any(not isinstance(value, (str, int, float, bool)) for value in record.attributes.values())):
            raise ValueError("Invalid attributes")
        if not record.id or not record.name:
            raise ValueError("Records require an id and name")
        _validate_iso_datetime(record.started_at)
        if record.ended_at is not None:
            _validate_iso_datetime(record.ended_at)
            if datetime.fromisoformat(record.ended_at.replace("Z", "+00:00")) < datetime.fromisoformat(record.started_at.replace("Z", "+00:00")):
                raise ValueError("Completion precedes start")
        duration_ms = _compute_duration_ms(record)
        spans.append(
            NormalizedTelemetrySpan(
                source=source,
                source_id=record.id,
                trace_id=record.trace_id or record.id,
                name=record.name,
                started_at=record.started_at,
                ended_at=record.ended_at,
                duration_ms=duration_ms,
                status=_normalize_status(record.status),
                attributes=sanitize_attributes(record.attributes or {}),
            )
        )
    return spans
