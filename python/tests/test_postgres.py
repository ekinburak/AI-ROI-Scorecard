from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from psycopg.errors import UniqueViolation

from ai_roi_scorecard import AttemptStartedEvent, PostgresScorecardRepository

DSN = os.getenv("TEST_POSTGRES_URL")


@pytest.mark.skipif(not DSN, reason="TEST_POSTGRES_URL is not configured")
def test_postgres_serializes_concurrent_writers() -> None:
    assert DSN is not None
    repository = PostgresScorecardRepository.connect(DSN)
    repository.migrate()
    account_id = f"test-{uuid4()}"

    def append(index: int):
        return repository.append(
            [
                AttemptStartedEvent(
                    event_id=f"event-{index}",
                    account_id=account_id,
                    run_id=f"run-{index}",
                    attempt_id=f"attempt-{index}",
                    workflow_key="ticket-triage",
                    policy_key="ticket-triage",
                    occurred_at="2026-08-01T00:00:00.000Z",
                )
            ]
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(append, range(8)))
    assert sorted(int(batch[0].sequence or 0) for batch in results) == list(range(1, 9))
    assert repository.get_watermark(account_id) == "8"

    replay = AttemptStartedEvent(
        event_id="event-0", account_id=account_id, run_id="run-0", attempt_id="attempt-0",
        workflow_key="ticket-triage", policy_key="ticket-triage", occurred_at="2026-08-01T00:00:00.000Z",
    )
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: repository.append_if_absent([replay, replay]), range(8)))
    assert not any(results)
    with pytest.raises(UniqueViolation):
        repository.append([replay])
    fresh = replay.model_copy(update={"event_id": "fresh"})
    with pytest.raises(ValueError, match="Conflicting evidence"):
        repository.append_if_absent([fresh, replay.model_copy(update={"workflow_key": "conflict"})])
    assert repository.get_watermark(account_id) == "8"
    assert len(repository.get_events(account_id)) == 8
    assert [event.sequence for event in repository.append_if_absent([fresh, fresh])] == ["9"]
