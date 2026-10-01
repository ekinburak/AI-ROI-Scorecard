from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from .models import ScorecardSnapshot

DashboardAudience = Literal["cfo", "operator"]
DashboardPeriodState = Literal["open", "sealed"]


@dataclass(frozen=True)
class DashboardOptions:
    account_name: str | None = None
    audience: DashboardAudience = "cfo"
    delta_label: str | None = None
    locale: str | None = None
    period_state: DashboardPeriodState = "open"
    previous_snapshot: ScorecardSnapshot | None = None


@dataclass(frozen=True)
class DashboardLineViewModel:
    label: str
    units: int
    hours: str
    dollars: str
    ai_runtime: str | None = None
    value_group_label: str | None = None


@dataclass(frozen=True)
class DashboardDeltaViewModel:
    label: str
    hours_saved: str | None = None
    dollars_saved: str | None = None


@dataclass(frozen=True)
class DashboardViewModel:
    account_name: str
    period_label: str
    period_state: DashboardPeriodState
    period_badge: str
    mode_label: str
    status: str
    status_label: str
    runtime_measurement: str
    hours_hero_label: str
    hours_hero: str
    dollars_hero_label: str
    dollars_hero: str
    usage_completed_outcomes: int
    usage_ai_runtime: str
    generated_at: str
    snapshot_hash: str
    lines: list[DashboardLineViewModel]
    service_cost: str | None = None
    net_value: str | None = None
    roi: str | None = None
    value_to_cost: str | None = None
    exceptions: int | None = None
    unresolved_exceptions: int | None = None
    approvals_requested: int | None = None
    evidence_issues: list[str] | None = None
    delta: DashboardDeltaViewModel | None = None
    empty_message: str | None = None
    attention_message: str | None = None


def _money(minor: str, currency: str, scale: int) -> str:
    value = int(minor)
    sign = "-" if value < 0 else ""
    absolute = abs(value)
    divisor = 10**scale
    return f"{sign}{currency} {absolute // divisor:,}.{absolute % divisor:0{scale}d}"


def _duration(milliseconds: str) -> str:
    value = int(milliseconds)
    sign = "−" if value < 0 else ""
    seconds = abs(value) / 1000
    if seconds < 60:
        return f"{sign}{seconds:.0f} sec"
    minutes = seconds / 60
    if minutes < 60:
        return f"{sign}{minutes:.1f} min"
    return f"{sign}{minutes / 60:.1f} hr"


def _period(snapshot: ScorecardSnapshot) -> str:
    start = datetime.fromisoformat(snapshot.period.start.replace("Z", "+00:00")).strftime(
        "%b %d, %Y"
    )
    end = datetime.fromisoformat(snapshot.period.end.replace("Z", "+00:00")).strftime(
        "%b %d, %Y"
    )
    return f"{start} – {end}"


def _format_delta_duration(delta_ms: int) -> str:
    sign = "−" if delta_ms < 0 else "+"
    return f"{sign}{_duration(str(abs(delta_ms)))}"


def _format_delta_money(delta_minor: int, currency: str, scale: int) -> str:
    sign = "−" if delta_minor < 0 else "+"
    absolute = abs(delta_minor)
    divisor = 10**scale
    return f"{sign}{currency} {absolute // divisor:,}.{absolute % divisor:0{scale}d}"


def to_dashboard_view_model(
    snapshot: ScorecardSnapshot,
    options: DashboardOptions | None = None,
) -> DashboardViewModel:
    options = options or DashboardOptions()
    currency = snapshot.currency
    scale = snapshot.currency_minor_unit_scale

    def format_money(value: str) -> str:
        return _money(value, currency, scale)

    runtime_measured = snapshot.runtime_measurement == "measured"
    manual_duration_ms = str(int(snapshot.totals.manual_minutes) * 60_000)

    hours_hero_label = "Hours saved" if runtime_measured else "Manual hours replaced"
    hours_hero = (
        _duration(snapshot.totals.time_saved_ms or "0")
        if runtime_measured
        else _duration(manual_duration_ms)
    )

    if snapshot.runtime_measurement == "measured":
        usage_ai_runtime = _duration(snapshot.totals.ai_duration_ms)
    elif snapshot.runtime_measurement == "partial":
        usage_ai_runtime = "Partially measured"
    else:
        usage_ai_runtime = "Not measured"

    delta: DashboardDeltaViewModel | None = None
    if options.previous_snapshot is not None:
        previous = options.previous_snapshot
        delta_label = options.delta_label or "vs last week"
        hours_delta: str | None = None
        if runtime_measured and previous.runtime_measurement == "measured":
            hours_delta = _format_delta_duration(
                int(snapshot.totals.time_saved_ms or "0") - int(previous.totals.time_saved_ms or "0")
            )
        dollars_delta = _format_delta_money(
            int(snapshot.totals.estimated_value_minor)
            - int(previous.totals.estimated_value_minor),
            currency,
            scale,
        )
        delta = DashboardDeltaViewModel(
            label=delta_label,
            hours_saved=hours_delta,
            dollars_saved=dollars_delta,
        )

    empty_message = (
        "No completed work this week yet"
        if snapshot.status == "send_not_recommended"
        else None
    )
    attention_message = (
        "Some evidence needs attention before this report is complete"
        if snapshot.status == "needs_attention"
        else None
    )

    roi: str | None = None
    if snapshot.totals.roi_basis_points is not None:
        roi = f"{int(snapshot.totals.roi_basis_points) / 100:.1f}%"

    value_to_cost: str | None = None
    if snapshot.totals.value_to_cost_basis_points is not None:
        value_to_cost = (
            f"{int(snapshot.totals.value_to_cost_basis_points) / 10_000:.1f}×"
        )

    lines = [
        DashboardLineViewModel(
            label=line.label,
            units=line.units,
            hours=_duration(str(int(line.manual_minutes) * 60_000)),
            dollars=format_money(line.estimated_value_minor),
            ai_runtime=(
                _duration(line.ai_duration_ms)
                if line.runtime_measurement == "measured"
                else None
            ),
            value_group_label=line.value_group_label,
        )
        for line in snapshot.line_items
    ]

    period_state = options.period_state
    return DashboardViewModel(
        account_name=options.account_name or snapshot.account_id,
        period_label=_period(snapshot),
        period_state=period_state,
        period_badge="Live" if period_state == "open" else "Sealed",
        mode_label=(
            "Illustrative estimate"
            if snapshot.mode == "illustrative"
            else "Evidence-backed report"
        ),
        status=snapshot.status,
        status_label=snapshot.status.replace("_", " "),
        runtime_measurement=snapshot.runtime_measurement,
        hours_hero_label=hours_hero_label,
        hours_hero=hours_hero,
        dollars_hero_label="Estimated dollars saved",
        dollars_hero=format_money(snapshot.totals.estimated_value_minor),
        usage_completed_outcomes=snapshot.totals.completed_outcomes,
        usage_ai_runtime=usage_ai_runtime,
        service_cost=(
            format_money(snapshot.totals.service_cost_minor)
            if snapshot.totals.service_cost_minor is not None
            else None
        ),
        net_value=(
            format_money(snapshot.totals.net_value_minor)
            if snapshot.totals.net_value_minor is not None
            else None
        ),
        roi=roi,
        value_to_cost=value_to_cost,
        lines=lines,
        empty_message=empty_message,
        attention_message=attention_message,
        delta=delta,
        generated_at=snapshot.generated_at,
        snapshot_hash=snapshot.snapshot_hash,
        exceptions=(
            snapshot.totals.exceptions if options.audience == "operator" else None
        ),
        unresolved_exceptions=(
            snapshot.totals.unresolved_exceptions if options.audience == "operator" else None
        ),
        approvals_requested=(
            snapshot.totals.approvals_requested if options.audience == "operator" else None
        ),
        evidence_issues=(
            list(snapshot.evidence_issues)
            if options.audience == "operator" and snapshot.evidence_issues
            else None
        ),
    )
