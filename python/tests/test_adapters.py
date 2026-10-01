from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_roi_scorecard.adapters import (
    TelemetryEvidenceMapper,
    TelemetryMapping,
    ingest_otlp_json,
    ingest_telemetry_evidence,
    parse_json_records,
    parse_otlp_json,
    sanitize_attributes,
)
from ai_roi_scorecard.storage import SqliteScorecardRepository

ROOT = Path(__file__).resolve().parents[2]
OTLP_INPUT = json.loads((ROOT / "fixtures/golden-otlp.input.json").read_text())
EXPECTED = json.loads((ROOT / "fixtures/golden-adapter-evidence.expected.json").read_text())


def test_otlp_golden_mapping() -> None:
    spans = parse_otlp_json(OTLP_INPUT)
    mapper = TelemetryEvidenceMapper(TelemetryMapping(account_id="fallback-account"))
    events = mapper.map_spans(spans)
    assert [event.model_dump(by_alias=True, exclude_none=True) for event in events] == EXPECTED


def test_success_mapping() -> None:
    spans = parse_json_records(
        [
            {
                "id": "span-1",
                "traceId": "trace-1",
                "name": "ticket-triage",
                "startedAt": "2026-08-22T10:00:00.000Z",
                "endedAt": "2026-08-22T10:00:01.200Z",
                "status": "ok",
                "attributes": {
                    "roi.workflow_key": "ticket-triage",
                    "roi.policy_key": "ticket-triage",
                    "roi.outcome_id": "ticket-99",
                },
            }
        ]
    )
    events = TelemetryEvidenceMapper(TelemetryMapping(account_id="demo-account")).map_spans(spans)
    assert [event.type for event in events] == [
        "attempt_started",
        "attempt_finished",
        "outcome_completed",
    ]
    assert events[1].active_duration_ms == 1200


def test_failure_mapping() -> None:
    spans = parse_json_records(
        [
            {
                "id": "span-fail",
                "name": "ticket-triage",
                "startedAt": "2026-08-22T10:00:00.000Z",
                "endedAt": "2026-08-22T10:00:00.500Z",
                "status": "error",
                "attributes": {
                    "roi.workflow_key": "ticket-triage",
                    "roi.policy_key": "ticket-triage",
                },
            }
        ]
    )
    events = TelemetryEvidenceMapper(TelemetryMapping(account_id="demo-account")).map_spans(spans)
    assert [event.type for event in events] == [
        "attempt_started",
        "attempt_finished",
        "exception_recorded",
    ]
    assert events[2].category == "TelemetryError"


def test_unmapped_span_dropped() -> None:
    spans = parse_json_records(
        [
            {
                "id": "span-unknown",
                "name": "http.request",
                "startedAt": "2026-08-22T10:00:00.000Z",
                "endedAt": "2026-08-22T10:00:00.500Z",
                "status": "ok",
            }
        ]
    )
    events = TelemetryEvidenceMapper(TelemetryMapping(account_id="demo-account")).map_spans(spans)
    assert events == []


def test_sanitize_attributes() -> None:
    sanitized = sanitize_attributes(
        {
            "prompt": "secret",
            "roi.workflow_key": "ticket-triage",
            "email": "user@example.com",
        }
    )
    assert sanitized == {"roi.workflow_key": "ticket-triage"}


def test_missing_duration_dropped_in_span_mode() -> None:
    spans = parse_json_records(
        [
            {
                "id": "span-no-duration",
                "name": "ticket-triage",
                "startedAt": "2026-08-22T10:00:00.000Z",
                "status": "ok",
                "attributes": {
                    "roi.workflow_key": "ticket-triage",
                    "roi.policy_key": "ticket-triage",
                },
            }
        ]
    )
    with pytest.raises(ValueError, match="completion timestamp"):
        TelemetryEvidenceMapper(TelemetryMapping(account_id="demo-account", duration_mode="span")).map_spans(spans)


def test_replay_ingest_skips_duplicates() -> None:
    repository = SqliteScorecardRepository()
    repository.migrate()
    spans = parse_otlp_json(OTLP_INPUT)
    events = TelemetryEvidenceMapper(TelemetryMapping(account_id="fallback-account")).map_spans(spans)
    first = ingest_telemetry_evidence(repository, events)
    second = ingest_telemetry_evidence(repository, events)
    assert len(first.appended) == len(events)
    assert second.skipped == len(events)
    assert second.appended == []
    assert repository.get_watermark("demo-account") == str(len(events))


def test_ingest_otlp_json_pipeline() -> None:
    repository = SqliteScorecardRepository()
    repository.migrate()
    first = ingest_otlp_json(repository, OTLP_INPUT, TelemetryMapping(account_id="fallback-account"))
    second = ingest_otlp_json(repository, OTLP_INPUT, TelemetryMapping(account_id="fallback-account"))
    assert first.spans == 1
    assert first.mapped == len(EXPECTED)
    assert len(first.appended) == len(EXPECTED)
    assert second.skipped == len(EXPECTED)
    assert second.appended == []
