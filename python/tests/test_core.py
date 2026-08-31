from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from ai_roi_scorecard import (
    canonical_json,
    estimate_scorecard,
    generate_scorecard,
    render_report,
    sha256_canonical,
)

ROOT = Path(__file__).resolve().parents[2]
INPUT = json.loads((ROOT / "fixtures/golden-v1.input.json").read_text())
EXPECTED = json.loads((ROOT / "fixtures/golden-v1.expected.json").read_text())


def test_cross_language_golden_snapshot() -> None:
    snapshot = generate_scorecard(INPUT)
    assert json.loads(canonical_json(snapshot)) == EXPECTED
    assert snapshot.snapshot_hash == "c26db4e166ba635bf46f48162dec82de240c1d820bdd3e812bc8f9160fd405e4"
    assert snapshot.source_fingerprint == "80e210a27dec26b89b7a72275140fa1769a4c0e9e906660a6c76e2ba2f8a7dfb"


def test_negative_roi_and_zero_cost_omission() -> None:
    base = {
        "period": {
            "start": "2026-08-01T00:00:00.000Z",
            "end": "2026-08-08T00:00:00.000Z",
        },
        "generatedAt": "2026-08-08T08:00:00.000Z",
        "workflows": [
            {
                "workflowKey": "task",
                "label": "Task",
                "manualMinutes": 60,
                "units": 1,
                "aiDurationMs": 1000,
            }
        ],
    }
    negative = estimate_scorecard(
        {
            **base,
            "valuation": {
                "currency": "USD",
                "hourlyValueMinor": "1000",
                "serviceCostMinor": "2000",
            },
        }
    )
    assert negative.totals.net_value_minor == "-1000"
    assert negative.totals.roi_basis_points == "-5000"

    omitted = estimate_scorecard(
        {
            **base,
            "valuation": {
                "currency": "USD",
                "hourlyValueMinor": "1000",
                "serviceCostMinor": "0",
            },
        }
    )
    assert omitted.totals.roi_basis_points is None
    assert omitted.totals.value_to_cost_basis_points is None


def test_team_value_rates_do_not_invent_unmeasured_runtime() -> None:
    snapshot = estimate_scorecard(
        {
            "period": {
                "start": "2026-08-01T00:00:00.000Z",
                "end": "2026-08-08T00:00:00.000Z",
            },
            "generatedAt": "2026-08-08T08:00:00.000Z",
            "workflows": [
                {
                    "workflowKey": "support",
                    "label": "Support work",
                    "manualMinutes": 60,
                    "units": 1,
                    "valueGroupKey": "customer-support",
                    "valueGroupLabel": "Customer support",
                    "hourlyValueMinor": "15000",
                },
                {
                    "workflowKey": "operations",
                    "label": "Operations work",
                    "manualMinutes": 120,
                    "units": 1,
                    "valueGroupKey": "operations",
                    "valueGroupLabel": "Operations",
                    "hourlyValueMinor": "8000",
                },
            ],
            "valuation": {"currency": "USD", "hourlyValueMinor": "10000"},
        }
    )
    assert snapshot.totals.estimated_value_minor == "31000"
    assert snapshot.runtime_measurement == "not_provided"
    assert snapshot.line_items[0].value_group_label == "Customer support"
    assert snapshot.line_items[0].hourly_value_minor == "15000"
    assert snapshot.line_items[0].runtime_measurement == "not_provided"
    report = render_report(snapshot)
    assert "AI runtime: Not measured" in report.text
    assert "Time difference: Available after instrumentation" in report.text
    assert "AI runtime: 0 sec" not in report.text


def test_canonical_hash_and_safe_renderer() -> None:
    assert canonical_json({"z": 1, "a": {"d": 2, "b": 3}}) == '{"a":{"b":3,"d":2},"z":1}'
    assert sha256_canonical({"b": 2, "a": 1}) == sha256_canonical({"a": 1, "b": 2})
    modified = json.loads(json.dumps(INPUT))
    modified["policies"][0]["label"]["default"] = "<script>alert(1)</script>"
    report = render_report(generate_scorecard(modified))
    assert "<script>alert" not in report.html
    assert "&lt;script&gt;" in report.html
    assert len(report.artifact_hash) == 64


def test_offset_instants_and_runtime_stay_on_the_policy_line() -> None:
    input_value = deepcopy(INPUT)
    for event in input_value["events"]:
        event["workflowKey"] = "support-automation"
    input_value["events"].extend(
        [
            {
                **input_value["events"][0],
                "eventId": "offset-start",
                "attemptId": "offset-attempt",
                "occurredAt": "2026-08-21T02:29:58.000+03:00",
                "sequence": "20",
            },
            {
                **input_value["events"][1],
                "eventId": "offset-finish",
                "attemptId": "offset-attempt",
                "occurredAt": "2026-08-21T02:29:59.000+03:00",
                "sequence": "21",
            },
            {
                **input_value["events"][2],
                "eventId": "offset-outcome",
                "outcomeId": "offset-outcome",
                "attemptId": "offset-attempt",
                "occurredAt": "2026-08-21T02:29:59.000+03:00",
                "sequence": "22",
            },
        ]
    )
    snapshot = generate_scorecard(input_value)
    assert snapshot.totals.completed_outcomes == 3
    runtimes = {line.policy_key: line.ai_duration_ms for line in snapshot.line_items}
    assert runtimes == {"reply-draft": "2300", "ticket-triage": "1200"}


def test_incomplete_lifecycle_and_abandoned_attempts() -> None:
    without_start = deepcopy(INPUT)
    without_start["events"] = [
        event for event in without_start["events"] if event["eventId"] != "event-01"
    ]
    assert "no start event" in " ".join(
        generate_scorecard(without_start).evidence_issues
    )
    assert generate_scorecard(without_start).runtime_measurement == "partial"

    without_exception = deepcopy(INPUT)
    without_exception["events"] = [
        event for event in without_exception["events"] if event["eventId"] != "event-06"
    ]
    assert "has no exception evidence" in " ".join(
        generate_scorecard(without_exception).evidence_issues
    )

    abandoned = deepcopy(INPUT)
    next(event for event in abandoned["events"] if event["eventId"] == "event-05")[
        "status"
    ] = "abandoned"
    assert generate_scorecard(abandoned).status == "ready"


def test_duplicate_outcome_is_not_double_valued() -> None:
    input_value = deepcopy(INPUT)
    input_value["events"].append(
        {**input_value["events"][2], "eventId": "duplicate-outcome", "sequence": "14"}
    )
    snapshot = generate_scorecard(input_value)
    assert snapshot.status == "needs_attention"
    assert snapshot.totals.completed_outcomes == 3
    assert "recorded more than once" in " ".join(snapshot.evidence_issues)
