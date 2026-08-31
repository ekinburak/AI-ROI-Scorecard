from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from ai_roi_scorecard import (
    AttemptStartedEvent,
    LocalizedLabel,
    SqliteScorecardRepository,
    ValuePolicy,
    estimate_scorecard,
)


def event(identifier: str) -> AttemptStartedEvent:
    return AttemptStartedEvent(
        event_id=identifier,
        account_id="demo",
        run_id=f"run-{identifier}",
        attempt_id=f"attempt-{identifier}",
        workflow_key="ticket-triage",
        policy_key="ticket-triage",
        occurred_at="2026-08-01T00:00:00.000Z",
    )


def test_sqlite_repository_watermarks_and_immutability() -> None:
    repository = SqliteScorecardRepository()
    repository.migrate()
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda index: repository.append([event(f"event-{index}")]), range(8)))
    assert sorted(int(batch[0].sequence or 0) for batch in results) == list(range(1, 9))
    assert repository.get_watermark("demo") == "8"

    policy = ValuePolicy(
        policy_key="ticket-triage",
        version=1,
        scope="default",
        label=LocalizedLabel(default="Ticket triage"),
        manual_minutes_per_unit=30,
        evidence_level="approved_baseline",
        effective_from="2026-01-01T00:00:00.000Z",
    )
    repository.put_policy(policy)
    repository.put_policy(policy)
    assert repository.get_policies("demo") == [policy]
    with pytest.raises(ValueError, match="immutable"):
        repository.put_policy(policy.model_copy(update={"manual_minutes_per_unit": 99}))

    snapshot = estimate_scorecard(
        {
            "period": {
                "start": "2026-08-01T00:00:00.000Z",
                "end": "2026-08-08T00:00:00.000Z",
            },
            "generatedAt": "2026-08-08T08:00:00.000Z",
            "workflows": [
                {
                    "workflowKey": "ticket-triage",
                    "label": "Ticket triage",
                    "manualMinutes": 30,
                    "units": 1,
                    "aiDurationMs": 50,
                }
            ],
            "valuation": {"currency": "USD", "hourlyValueMinor": "6000"},
        }
    )
    assert repository.put_snapshot(snapshot) == snapshot
    assert repository.put_snapshot(snapshot) == snapshot
    repository.close()


def test_sqlite_duplicate_event_rolls_back_cursor() -> None:
    repository = SqliteScorecardRepository()
    repository.migrate()
    repository.append([event("same")])
    with pytest.raises(sqlite3.IntegrityError):
        repository.append([event("same")])
    assert repository.get_watermark("demo") == "1"
    repository.close()
