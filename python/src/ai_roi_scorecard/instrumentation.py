from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from functools import wraps
from typing import Any, ParamSpec, Protocol, TypeVar, cast
from uuid import uuid4

from .models import (
    AttemptFinishedEvent,
    AttemptStartedEvent,
    EvidenceEvent,
    ExceptionRecordedEvent,
    OutcomeCompletedEvent,
)

P = ParamSpec("P")
R = TypeVar("R")


class EvidenceSink(Protocol):
    def append(self, events: list[EvidenceEvent]) -> Any: ...


@dataclass(frozen=True)
class InstrumentationConfig:
    account_id: str
    workflow_key: str
    policy_key: str
    sink: EvidenceSink
    now: Callable[[], str] = lambda: __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    monotonic_ns: Callable[[], int] = time.monotonic_ns
    id_factory: Callable[[], str] = lambda: str(uuid4())
    classify_error: Callable[[BaseException], tuple[str, str | None]] = lambda error: (
        type(error).__name__,
        None,
    )


@dataclass(frozen=True)
class InstrumentRunOptions:
    run_id: str | None = None
    attempt_id: str | None = None
    outcome_id: str | None = None
    units: int = 1
    record_outcome: bool = True


@dataclass(frozen=True)
class InstrumentedResult:
    result: Any
    run_id: str
    attempt_id: str


def _base(config: InstrumentationConfig, run_id: str, attempt_id: str) -> dict[str, str]:
    return {
        "account_id": config.account_id,
        "run_id": run_id,
        "attempt_id": attempt_id,
        "workflow_key": config.workflow_key,
        "policy_key": config.policy_key,
    }


def _finish_events(
    config: InstrumentationConfig,
    options: InstrumentRunOptions,
    run_id: str,
    attempt_id: str,
    started_ns: int,
    error: BaseException | None = None,
) -> list[EvidenceEvent]:
    finished_at = config.now()
    duration_ms = max(0, round((config.monotonic_ns() - started_ns) / 1_000_000))
    base = _base(config, run_id, attempt_id)
    if error is not None:
        category, safe_message = config.classify_error(error)
        return [
            AttemptFinishedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=finished_at,
                status="failed",
                active_duration_ms=duration_ms,
            ),
            ExceptionRecordedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=finished_at,
                exception_id=config.id_factory(),
                category=category,
                safe_message=safe_message,
            ),
        ]
    events: list[EvidenceEvent] = [
        AttemptFinishedEvent(
            **base,
            event_id=config.id_factory(),
            occurred_at=finished_at,
            status="succeeded",
            active_duration_ms=duration_ms,
        )
    ]
    if options.record_outcome:
        events.append(
            OutcomeCompletedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=finished_at,
                outcome_id=options.outcome_id or config.id_factory(),
                units=options.units,
            )
        )
    return events


def instrument_sync(
    config: InstrumentationConfig,
    work: Callable[[], R],
    options: InstrumentRunOptions | None = None,
) -> InstrumentedResult:
    options = options or InstrumentRunOptions()
    run_id = options.run_id or config.id_factory()
    attempt_id = options.attempt_id or config.id_factory()
    base = _base(config, run_id, attempt_id)
    config.sink.append(
        [
            AttemptStartedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=config.now(),
            )
        ]
    )
    started_ns = config.monotonic_ns()
    try:
        result = work()
    except BaseException as error:
        config.sink.append(_finish_events(config, options, run_id, attempt_id, started_ns, error))
        raise
    config.sink.append(_finish_events(config, options, run_id, attempt_id, started_ns))
    return InstrumentedResult(result=result, run_id=run_id, attempt_id=attempt_id)


async def instrument_async(
    config: InstrumentationConfig,
    work: Callable[[], Awaitable[R]],
    options: InstrumentRunOptions | None = None,
) -> InstrumentedResult:
    options = options or InstrumentRunOptions()
    run_id = options.run_id or config.id_factory()
    attempt_id = options.attempt_id or config.id_factory()
    base = _base(config, run_id, attempt_id)
    appended = config.sink.append(
        [
            AttemptStartedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=config.now(),
            )
        ]
    )
    if inspect.isawaitable(appended):
        await appended
    started_ns = config.monotonic_ns()
    try:
        result = await work()
    except BaseException as error:
        appended = config.sink.append(
            _finish_events(config, options, run_id, attempt_id, started_ns, error)
        )
        if inspect.isawaitable(appended):
            await appended
        raise
    appended = config.sink.append(_finish_events(config, options, run_id, attempt_id, started_ns))
    if inspect.isawaitable(appended):
        await appended
    return InstrumentedResult(result=result, run_id=run_id, attempt_id=attempt_id)


def track_workflow(
    config: InstrumentationConfig,
    *,
    options_factory: Callable[..., InstrumentRunOptions] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(function: Callable[P, R]) -> Callable[P, R]:
        if asyncio.iscoroutinefunction(function):

            @wraps(function)
            async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
                options = options_factory(*args, **kwargs) if options_factory else None
                output = await instrument_async(
                    config,
                    lambda: cast(Callable[P, Awaitable[Any]], function)(*args, **kwargs),
                    options,
                )
                return output.result

            return cast(Callable[P, R], async_wrapper)

        @wraps(function)
        def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
            options = options_factory(*args, **kwargs) if options_factory else None
            return instrument_sync(config, lambda: function(*args, **kwargs), options).result

        return cast(Callable[P, R], sync_wrapper)

    return decorator


@contextmanager
def workflow_attempt(
    config: InstrumentationConfig,
    options: InstrumentRunOptions | None = None,
) -> Iterator[tuple[str, str]]:
    options = options or InstrumentRunOptions()
    run_id = options.run_id or config.id_factory()
    attempt_id = options.attempt_id or config.id_factory()
    base = _base(config, run_id, attempt_id)
    config.sink.append(
        [
            AttemptStartedEvent(
                **base,
                event_id=config.id_factory(),
                occurred_at=config.now(),
            )
        ]
    )
    started_ns = config.monotonic_ns()
    try:
        yield run_id, attempt_id
    except BaseException as error:
        config.sink.append(_finish_events(config, options, run_id, attempt_id, started_ns, error))
        raise
    config.sink.append(_finish_events(config, options, run_id, attempt_id, started_ns))
