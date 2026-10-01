from __future__ import annotations

import json
from pathlib import Path

from ai_roi_scorecard import ScorecardSnapshot, to_dashboard_view_model
from ai_roi_scorecard.dashboard_view import DashboardOptions

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ScorecardSnapshot.model_validate(
    json.loads((ROOT / "fixtures/golden-v1.expected.json").read_text())
)
EXPECTED = json.loads((ROOT / "fixtures/golden-dashboard-view.expected.json").read_text())


def test_dashboard_view_golden() -> None:
    view = to_dashboard_view_model(
        SNAPSHOT,
        DashboardOptions(account_name="Demo account", period_state="open"),
    )
    assert view.account_name == EXPECTED["accountName"]
    assert view.hours_hero_label == EXPECTED["hoursHeroLabel"]
    assert "275.00" in view.dollars_hero
    assert view.period_badge == EXPECTED["periodBadge"]
    assert len(view.lines) == len(EXPECTED["lines"])


def test_dashboard_view_unmeasured_runtime() -> None:
    from ai_roi_scorecard import estimate_scorecard

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
                    "label": "Support triage",
                    "manualMinutes": 30,
                    "units": 2,
                }
            ],
            "valuation": {"currency": "USD", "hourlyValueMinor": "10000"},
        }
    )
    view = to_dashboard_view_model(snapshot)
    assert view.hours_hero_label == "Manual hours replaced"
    assert view.usage_ai_runtime == "Not measured"
