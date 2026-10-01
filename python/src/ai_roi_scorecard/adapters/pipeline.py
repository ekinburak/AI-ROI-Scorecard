from __future__ import annotations

from dataclasses import dataclass

from ..models import EvidenceEvent
from ..storage import ScorecardRepository
from .ingest import ingest_telemetry_evidence
from .json import parse_json_records
from .mapper import TelemetryEvidenceMapper
from .otel import parse_otlp_json
from .types import JsonTelemetryRecord, TelemetryMapping


@dataclass(frozen=True)
class TelemetryPipelineResult:
    appended: list[EvidenceEvent]
    skipped: int
    mapped: int
    spans: int


def ingest_otlp_json(
    repository: ScorecardRepository,
    payload: dict[str, object],
    mapping: TelemetryMapping,
) -> TelemetryPipelineResult:
    spans = parse_otlp_json(payload)
    events = TelemetryEvidenceMapper(mapping).map_spans(spans)
    result = ingest_telemetry_evidence(repository, events)
    return TelemetryPipelineResult(
        appended=result.appended,
        skipped=result.skipped,
        mapped=len(events),
        spans=len(spans),
    )


def ingest_json_records(
    repository: ScorecardRepository,
    records: list[JsonTelemetryRecord | dict[str, object]],
    mapping: TelemetryMapping,
) -> TelemetryPipelineResult:
    spans = parse_json_records(records)
    events = TelemetryEvidenceMapper(mapping).map_spans(spans)
    result = ingest_telemetry_evidence(repository, events)
    return TelemetryPipelineResult(
        appended=result.appended,
        skipped=result.skipped,
        mapped=len(events),
        spans=len(spans),
    )
