from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import pytest

from ai_roi_scorecard import (
    ScorecardSnapshot,
    canonical_json,
    generate_scorecard,
    sha256_canonical,
    to_dashboard_view_model,
)
from ai_roi_scorecard.adapters import (
    TelemetryEvidenceMapper,
    TelemetryMapping,
    ingest_otlp_json,
    parse_otlp_json,
)
from ai_roi_scorecard.storage import SqliteScorecardRepository

ROOT = Path(__file__).resolve().parents[2]


def load(name: str) -> dict:
    return json.loads((ROOT / "fixtures" / name).read_text())


def test_legacy_preserves_wire_and_hash() -> None:
    legacy = load("golden-v1.expected.json")
    snapshot = ScorecardSnapshot.model_validate(legacy)
    assert json.loads(canonical_json(snapshot)) == legacy
    body = dict(legacy)
    assert sha256_canonical({key: value for key, value in body.items() if key != "snapshotHash"}) == legacy["snapshotHash"]
    repository = SqliteScorecardRepository()
    repository.migrate()
    repository.put_snapshot(snapshot)
    assert repository.get_snapshot_by_fingerprint(snapshot.account_id, snapshot.source_fingerprint) == snapshot
    repository.close()


def test_unmeasured_zero_and_partial() -> None:
    value = load("golden-v1.input.json")
    finishes = [event for event in value["events"] if event["type"] == "attempt_finished"]
    for event in finishes:
        event.pop("activeDurationMs")
    snapshot = generate_scorecard(value)
    assert snapshot.status == "ready"
    assert snapshot.runtime_measurement == "not_provided"
    assert snapshot.totals.time_saved_ms is None
    assert snapshot.totals.estimated_value_minor == "27500"
    assert to_dashboard_view_model(snapshot).hours_hero_label == "Manual hours replaced"
    for event in finishes:
        event["activeDurationMs"] = 0
    assert generate_scorecard(value).runtime_measurement == "measured"
    finishes[1].pop("activeDurationMs")
    mixed = generate_scorecard(value)
    assert mixed.runtime_measurement == "partial"
    assert mixed.totals.time_saved_ms is None
    assert any(line.runtime_measurement == "partial" for line in mixed.line_items)


def test_omit_and_invalid_units() -> None:
    spans = parse_otlp_json(load("golden-otlp.input.json"))
    mapper = TelemetryEvidenceMapper(TelemetryMapping(account_id="demo-account", duration_mode="omit"))
    assert "activeDurationMs" not in json.loads(canonical_json(mapper.map_spans(spans)[1]))
    for units in [0, -1, 1.5, "1.5", True, 1_000_000_001]:
        span = deepcopy(spans[0])
        span.attributes["roi.units"] = units
        with pytest.raises(ValueError):
            mapper.map_spans([span])


def test_atomic_batch_replay_and_conflicts() -> None:
    repository = SqliteScorecardRepository()
    repository.migrate()
    payload = load("golden-otlp.input.json")
    spans = payload["resourceSpans"][0]["scopeSpans"][0]["spans"]
    spans.append(deepcopy(spans[0]))
    mapping = TelemetryMapping(account_id="demo-account")
    first = ingest_otlp_json(repository, payload, mapping)
    assert len(first.appended) == 3 and first.skipped == 3
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: ingest_otlp_json(repository, payload, mapping), range(8)))
    assert all(len(result.appended) == 0 and result.skipped == 6 for result in results)
    events = first.appended
    with pytest.raises(ValueError, match="Conflicting evidence"):
        repository.append_if_absent([events[0].model_copy(update={"event_id": "fresh"}), events[0].model_copy(update={"workflow_key": "different"})])
    assert repository.get_watermark("demo-account") == "3"
    assert len(repository.get_events("demo-account")) == 3
    repository.close()
