from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

TelemetrySpanStatus = Literal["ok", "error", "unset"]
DurationMode = Literal["span", "omit"]


@dataclass(frozen=True)
class NormalizedTelemetrySpan:
    source: str
    source_id: str
    trace_id: str
    name: str
    started_at: str
    status: TelemetrySpanStatus
    attributes: dict[str, str | int | float | bool]
    ended_at: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class TelemetryMapping:
    account_id: str
    workflow_key: Callable[[NormalizedTelemetrySpan], str | None] | None = None
    policy_key: Callable[[NormalizedTelemetrySpan], str | None] | None = None
    outcome_id: Callable[[NormalizedTelemetrySpan], str | None] | None = None
    record_outcome: Callable[[NormalizedTelemetrySpan], bool] | None = None
    units: Callable[[NormalizedTelemetrySpan], int | None] | None = None
    duration_mode: DurationMode = "span"
    exception_category: Callable[[NormalizedTelemetrySpan], str | None] | None = None


@dataclass(frozen=True)
class JsonTelemetryRecord:
    id: str
    name: str
    started_at: str
    trace_id: str | None = None
    ended_at: str | None = None
    status: TelemetrySpanStatus | None = None
    attributes: dict[str, str | int | float | bool] | None = None
