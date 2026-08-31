from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html import escape

from .canonical import canonical_json, sha256_canonical
from .models import RENDERER_VERSION, ScorecardLineItem, ScorecardSnapshot


@dataclass(frozen=True)
class ReportOptions:
    account_name: str | None = None
    include_runtime: bool = True
    locale: str | None = None
    title: str | None = None


@dataclass(frozen=True)
class RenderedReport:
    html: str
    text: str
    renderer_version: str
    artifact_hash: str


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
    start = datetime.fromisoformat(snapshot.period.start.replace("Z", "+00:00")).strftime("%b %d, %Y")
    end = datetime.fromisoformat(snapshot.period.end.replace("Z", "+00:00")).strftime("%b %d, %Y")
    return f"{start} – {end}"


def _runtime_summary(snapshot: ScorecardSnapshot) -> tuple[str, str]:
    if snapshot.runtime_measurement == "measured":
        return (
            _duration(snapshot.totals.ai_duration_ms),
            _duration(snapshot.totals.time_saved_ms),
        )
    if snapshot.runtime_measurement == "partial":
        return "Partially measured", "Available after complete instrumentation"
    return "Not measured", "Available after instrumentation"


def render_text_report(
    snapshot: ScorecardSnapshot, options: ReportOptions | None = None
) -> str:
    options = options or ReportOptions()
    def money(value: str) -> str:
        return _money(value, snapshot.currency, snapshot.currency_minor_unit_scale)
    title = options.title or "Weekly AI value scorecard"
    account = options.account_name or snapshot.account_id
    mode = "Illustrative estimate" if snapshot.mode == "illustrative" else "Evidence-backed report"
    ai_runtime, time_difference = _runtime_summary(snapshot)
    lines = [
        title,
        f"{account} · {_period(snapshot)}",
        mode,
        "",
        f"Estimated value: {money(snapshot.totals.estimated_value_minor)}",
        f"Manual time: {_duration(str(int(snapshot.totals.manual_minutes) * 60_000))}",
    ]
    if options.include_runtime:
        lines.extend([f"AI runtime: {ai_runtime}", f"Time difference: {time_difference}"])
    if snapshot.totals.service_cost_minor is not None:
        lines.append(f"Service cost: {money(snapshot.totals.service_cost_minor)}")
    if snapshot.totals.net_value_minor is not None:
        lines.append(f"Net value: {money(snapshot.totals.net_value_minor)}")
    if snapshot.totals.roi_basis_points is not None:
        lines.append(f"ROI: {int(snapshot.totals.roi_basis_points) / 100:.1f}%")
    if snapshot.totals.value_to_cost_basis_points is not None:
        lines.append(
            f"Value to cost: {int(snapshot.totals.value_to_cost_basis_points) / 10_000:.1f}×"
        )
    lines.extend(
        [
            f"Exceptions: {snapshot.totals.exceptions} ({snapshot.totals.unresolved_exceptions} unresolved)",
            f"Approvals requested: {snapshot.totals.approvals_requested}",
            "",
            "Work completed",
        ]
    )
    if snapshot.line_items:
        for line in snapshot.line_items:
            runtime = (
                f"{_duration(line.ai_duration_ms)} AI"
                if line.runtime_measurement == "measured"
                else "AI runtime not measured"
            )
            details = [
                f"{line.units} completed",
                f"{_duration(str(int(line.manual_minutes) * 60_000))} manual",
            ]
            if options.include_runtime:
                details.append(runtime)
            details.append(money(line.estimated_value_minor))
            lines.append(f"- {line.label}: {' · '.join(details)}")
    else:
        lines.append("- No completed work in this period.")
    if snapshot.evidence_issues:
        lines.extend(["", "Evidence requiring attention"])
        lines.extend(f"- {issue}" for issue in snapshot.evidence_issues)
    lines.extend(["", f"Snapshot: {snapshot.snapshot_hash}"])
    return "\n".join(lines)


def render_html_report(
    snapshot: ScorecardSnapshot, options: ReportOptions | None = None
) -> str:
    options = options or ReportOptions()
    def money(value: str) -> str:
        return _money(value, snapshot.currency, snapshot.currency_minor_unit_scale)
    title = options.title or "Weekly AI value scorecard"
    account = options.account_name or snapshot.account_id
    mode = "Illustrative estimate" if snapshot.mode == "illustrative" else "Evidence-backed report"
    ai_runtime, time_difference = _runtime_summary(snapshot)
    def row(line: ScorecardLineItem) -> str:
        runtime_cell = ""
        if options.include_runtime:
            runtime = (
                _duration(line.ai_duration_ms)
                if line.runtime_measurement == "measured"
                else "Not measured"
            )
            runtime_cell = f"<td>{escape(runtime)}</td>"
        return (
            f"<tr><td>{escape(line.label)}</td><td>{line.units}</td>"
            f"<td>{escape(_duration(str(int(line.manual_minutes) * 60_000)))}</td>"
            f"{runtime_cell}<td>{escape(money(line.estimated_value_minor))}</td></tr>"
        )

    rows = "".join(row(line) for line in snapshot.line_items) or (
        f'<tr><td colspan="{5 if options.include_runtime else 4}">'
        "No completed work in this period.</td></tr>"
    )
    optional_metrics: list[tuple[str, str]] = []
    if snapshot.totals.service_cost_minor is not None:
        optional_metrics.append(("Service cost", money(snapshot.totals.service_cost_minor)))
    if snapshot.totals.net_value_minor is not None:
        optional_metrics.append(("Net value", money(snapshot.totals.net_value_minor)))
    if snapshot.totals.roi_basis_points is not None:
        optional_metrics.append(("ROI", f"{int(snapshot.totals.roi_basis_points) / 100:.1f}%"))
    if snapshot.totals.value_to_cost_basis_points is not None:
        optional_metrics.append(
            (
                "Value / cost",
                f"{int(snapshot.totals.value_to_cost_basis_points) / 10_000:.1f}×",
            )
        )

    def metric(label: str, value: str, primary: bool = False) -> str:
        modifier = " metric--primary" if primary else ""
        return (
            f'<div class="metric{modifier}"><span>{escape(label)}</span>'
            f"<strong>{escape(value)}</strong></div>"
        )

    issues = ""
    if snapshot.evidence_issues:
        issue_items = "".join(f"<li>{escape(issue)}</li>" for issue in snapshot.evidence_issues)
        issues = (
            '<section class="issues"><h2>Evidence requiring attention</h2>'
            f"<ul>{issue_items}</ul></section>"
        )
    metrics = "".join(
        [
            metric("Estimated value", money(snapshot.totals.estimated_value_minor), True),
            metric(
                "Manual time",
                _duration(str(int(snapshot.totals.manual_minutes) * 60_000)),
            ),
            *(
                [metric("AI runtime", ai_runtime), metric("Time difference", time_difference)]
                if options.include_runtime
                else []
            ),
            *(metric(label, value) for label, value in optional_metrics),
        ]
    )
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f4f4f1;color:#171716;font:14px/1.45 Inter,system-ui,sans-serif}}.page{{max-width:960px;margin:24px auto;background:#fff;padding:38px;border:1px solid #deded8;border-radius:16px}}header{{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e7e7e2;padding-bottom:24px}}.eyebrow{{color:#58766d;font-size:12px;letter-spacing:.12em;text-transform:uppercase}}h1{{font-size:30px;line-height:1.05;letter-spacing:-.03em;margin:7px 0 10px}}p{{margin:0;color:#676762}}.status{{font-size:12px;border:1px solid #d8d8d2;border-radius:99px;padding:6px 10px;white-space:nowrap}}.metrics{{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#deded8;margin:28px 0;border:1px solid #deded8;border-radius:12px;overflow:hidden}}.metric{{background:#f8f8f5;padding:16px;min-height:88px}}.metric span{{display:block;color:#73736e;font-size:12px;margin-bottom:10px}}.metric strong{{font-size:20px}}.metric--primary{{background:#171716;color:#faf9f6}}h2{{font-size:16px}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:11px 8px;border-bottom:1px solid #ecece7}}th:last-child,td:last-child{{text-align:right}}.summary,.issues{{margin-top:22px;padding:16px;background:#f8f8f5;border-radius:10px}}footer{{margin-top:24px;color:#8a8a84;font:11px monospace;word-break:break-all}}@media(max-width:720px){{.page{{margin:0;padding:22px;border-radius:0}}.metrics{{grid-template-columns:1fr 1fr}}header{{flex-direction:column}}}}@media print{{body{{background:#fff}}.page{{margin:0;max-width:none;border:0}}}}</style></head>
<body><main class="page"><header><div><div class="eyebrow">{escape(mode)}</div><h1>{escape(title)}</h1><p>{escape(account)} · {escape(_period(snapshot))}</p></div><div class="status">{escape(snapshot.status.replace('_', ' '))}</div></header><section class="metrics">{metrics}</section><section><h2>Work completed</h2><table><thead><tr><th>Workflow</th><th>Completed</th><th>Manual</th>{'<th>AI</th>' if options.include_runtime else ''}<th>Value</th></tr></thead><tbody>{rows}</tbody></table></section><section class="summary">Exceptions: {snapshot.totals.exceptions} · Unresolved: {snapshot.totals.unresolved_exceptions} · Human approvals: {snapshot.totals.approvals_requested}</section>{issues}<footer>Snapshot {escape(snapshot.snapshot_hash)}</footer></main></body></html>"""


def render_report(
    snapshot: ScorecardSnapshot, options: ReportOptions | None = None
) -> RenderedReport:
    html = render_html_report(snapshot, options)
    text = render_text_report(snapshot, options)
    return RenderedReport(
        html=html,
        text=text,
        renderer_version=RENDERER_VERSION,
        artifact_hash=sha256_canonical(
            {"html": html, "rendererVersion": RENDERER_VERSION, "text": text}
        ),
    )


def export_snapshot_json(snapshot: ScorecardSnapshot) -> str:
    return canonical_json(snapshot)
