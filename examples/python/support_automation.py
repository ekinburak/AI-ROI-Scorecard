from __future__ import annotations

import asyncio
from typing import Any

from ai_roi_scorecard import (
    InstrumentationConfig,
    InstrumentRunOptions,
    generate_scorecard,
    instrument_async,
    render_report,
)


class MemorySink:
    def __init__(self) -> None:
        self.events: list[Any] = []

    def append(self, events: list[Any]) -> None:
        self.events.extend(events)


async def main() -> None:
    sink = MemorySink()
    config = InstrumentationConfig(
        account_id="support-demo",
        workflow_key="ticket-triage",
        policy_key="ticket-triage",
        sink=sink,
        now=lambda: "2026-08-22T10:00:00.000Z",
    )
    await instrument_async(
        config,
        lambda: classify_ticket(),
        InstrumentRunOptions(
            run_id="run-1", attempt_id="attempt-1", outcome_id="ticket-1042"
        ),
    )
    snapshot = generate_scorecard(
        {
            "accountId": "support-demo",
            "period": {
                "start": "2026-08-21T00:00:00.000Z",
                "end": "2026-08-28T00:00:00.000Z",
            },
            "generatedAt": "2026-08-28T08:00:00.000Z",
            "events": [event.model_dump(by_alias=True, exclude_none=True) for event in sink.events],
            "policies": [
                {
                    "policyKey": "ticket-triage",
                    "version": 1,
                    "scope": "default",
                    "label": {"default": "Support ticket triage"},
                    "manualMinutesPerUnit": 30,
                    "evidenceLevel": "approved_baseline",
                    "effectiveFrom": "2026-01-01T00:00:00.000Z",
                }
            ],
            "valuation": {
                "currency": "USD",
                "hourlyValueMinor": "9000",
                "serviceCostMinor": "1000",
            },
        }
    )
    print(render_report(snapshot).text)


async def classify_ticket() -> dict[str, str]:
    return {"category": "billing"}


if __name__ == "__main__":
    asyncio.run(main())
