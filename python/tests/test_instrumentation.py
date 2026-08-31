from __future__ import annotations

from collections.abc import Iterator

import pytest

from ai_roi_scorecard import (
    AttemptFinishedEvent,
    EvidenceEvent,
    ExceptionRecordedEvent,
    InstrumentationConfig,
    InstrumentRunOptions,
    instrument_async,
    instrument_sync,
    workflow_attempt,
)


class Sink:
    def __init__(self) -> None:
        self.events: list[EvidenceEvent] = []

    def append(self, events: list[EvidenceEvent]) -> None:
        self.events.extend(events)


def values(*items: int) -> Iterator[int]:
    yield from items


def ids() -> Iterator[str]:
    index = 0
    while True:
        index += 1
        yield f"id-{index}"


def config(sink: Sink) -> InstrumentationConfig:
    clock = values(100_000_000, 1_350_000_000)
    identifiers = ids()
    wall = iter(["2026-08-01T00:00:00.000Z", "2026-08-01T00:00:01.250Z"])
    return InstrumentationConfig(
        account_id="demo",
        workflow_key="ticket-triage",
        policy_key="ticket-triage",
        sink=sink,
        now=lambda: next(wall),
        monotonic_ns=lambda: next(clock),
        id_factory=lambda: next(identifiers),
    )


@pytest.mark.asyncio
async def test_async_success_records_runtime_and_outcome() -> None:
    sink = Sink()
    result = await instrument_async(
        config(sink),
        lambda: _result("done"),
        InstrumentRunOptions(outcome_id="outcome-1", units=2),
    )
    assert result.result == "done"
    assert [event.type for event in sink.events] == [
        "attempt_started",
        "attempt_finished",
        "outcome_completed",
    ]
    assert isinstance(sink.events[1], AttemptFinishedEvent)
    assert sink.events[1].active_duration_ms == 1250


async def _result(value: str) -> str:
    return value


def test_sync_failure_records_safe_exception_and_rethrows() -> None:
    sink = Sink()
    with pytest.raises(RuntimeError, match="private diagnostic"):
        instrument_sync(config(sink), lambda: _raise())
    assert [event.type for event in sink.events] == [
        "attempt_started",
        "attempt_finished",
        "exception_recorded",
    ]
    assert isinstance(sink.events[2], ExceptionRecordedEvent)
    assert sink.events[2].safe_message is None


def _raise() -> None:
    raise RuntimeError("private diagnostic")


def test_context_manager_records_completion() -> None:
    sink = Sink()
    with workflow_attempt(config(sink), InstrumentRunOptions(outcome_id="outcome-1")):
        pass
    assert sink.events[-1].type == "outcome_completed"
