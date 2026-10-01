import type { DashboardViewModel } from "../dashboard-view.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const DASHBOARD_STYLES = `
:host {
  --roi-dashboard-canvas: #121212;
  --roi-dashboard-surface: #1e1e1d;
  --roi-dashboard-deep: #090909;
  --roi-dashboard-primary: #faf9f6;
  --roi-dashboard-muted: #868684;
  --roi-dashboard-secondary: #afaeac;
  --roi-dashboard-accent: #799c92;
  --roi-dashboard-border: #2f2f2f;
  --roi-dashboard-mono: ui-monospace, monospace;
  display: block;
  color: var(--roi-dashboard-primary);
  font: 14px/1.45 ui-sans-serif, system-ui, sans-serif;
}
.shell {
  overflow: hidden;
  border-radius: 16px;
  background: var(--roi-dashboard-surface);
}
.bar {
  min-height: 42px;
  padding: 0 14px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  background: var(--roi-dashboard-deep);
  color: var(--roi-dashboard-muted);
  font: 11px/1 var(--roi-dashboard-mono);
}
.bar > :last-child { text-align: right; color: var(--roi-dashboard-accent); }
.body { padding: 24px; }
.eyebrow {
  color: var(--roi-dashboard-accent);
  font: 11px var(--roi-dashboard-mono);
  letter-spacing: .11em;
  text-transform: uppercase;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
}
.head h2 {
  margin: 6px 0 4px;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -.025em;
}
.meta { color: var(--roi-dashboard-muted); font-size: 13px; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; }
.badge {
  padding: 5px 9px;
  border: 1px solid #40403f;
  border-radius: 50px;
  color: var(--roi-dashboard-secondary);
  font: 11px var(--roi-dashboard-mono);
  white-space: nowrap;
}
.badge--live { border-color: #315048; color: #91b5ab; }
.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.hero-card {
  padding: 20px;
  border-radius: 10px;
  background: var(--roi-dashboard-canvas);
}
.hero-card span {
  display: block;
  color: var(--roi-dashboard-muted);
  font-size: 11px;
}
.hero-card strong {
  display: block;
  margin-top: 8px;
  font: 500 clamp(28px, 4vw, 44px)/1 var(--roi-dashboard-mono);
  letter-spacing: -.04em;
}
.delta {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--roi-dashboard-canvas);
  color: var(--roi-dashboard-secondary);
  font-size: 12px;
}
.delta strong { color: var(--roi-dashboard-primary); font-family: var(--roi-dashboard-mono); }
.usage {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin-bottom: 16px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--roi-dashboard-border);
}
.usage > div {
  padding: 13px;
  background: var(--roi-dashboard-canvas);
}
.usage span { display: block; color: var(--roi-dashboard-muted); font-size: 11px; }
.usage strong {
  display: block;
  margin-top: 6px;
  font: 500 16px var(--roi-dashboard-mono);
}
.roi-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin-bottom: 16px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--roi-dashboard-border);
}
.roi-strip > div {
  padding: 13px;
  background: var(--roi-dashboard-canvas);
}
.roi-strip span { display: block; color: var(--roi-dashboard-muted); font-size: 11px; }
.roi-strip strong {
  display: block;
  margin-top: 6px;
  font: 500 16px var(--roi-dashboard-mono);
}
.work h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 500;
}
.work-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--roi-dashboard-border);
  font-size: 14px;
}
.work-item:last-child { border-bottom: 0; }
.work-item small {
  display: block;
  margin-top: 3px;
  color: var(--roi-dashboard-muted);
  font: 11px var(--roi-dashboard-mono);
}
.work-item strong { font-family: var(--roi-dashboard-mono); }
.notice {
  margin: 16px 0;
  padding: 12px 14px;
  border: 1px solid var(--roi-dashboard-accent);
  border-radius: 10px;
  color: var(--roi-dashboard-secondary);
  font-size: 12px;
}
.operator {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--roi-dashboard-canvas);
  font-size: 12px;
  color: var(--roi-dashboard-secondary);
}
.operator ul { margin: 8px 0 0; padding-left: 18px; }
.footer {
  margin-top: 20px;
  color: var(--roi-dashboard-muted);
  font: 11px var(--roi-dashboard-mono);
  word-break: break-all;
}
@media (max-width: 640px) {
  .hero, .usage, .roi-strip { grid-template-columns: 1fr; }
}
`;

export function renderDashboardMarkup(view: DashboardViewModel): string {
  const delta = view.delta
    ? `<div class="delta">${escapeHtml(view.delta.label)}: ${
        view.delta.hoursSaved
          ? `<strong>${escapeHtml(view.delta.hoursSaved)}</strong> hours · `
          : ""
      }<strong>${escapeHtml(view.delta.dollarsSaved ?? "")}</strong> dollars</div>`
    : "";

  const roiStrip =
    view.serviceCost !== undefined
      ? `<div class="roi-strip">
          <div><span>Service cost</span><strong>${escapeHtml(view.serviceCost)}</strong></div>
          <div><span>Net value</span><strong>${escapeHtml(view.netValue ?? "")}</strong></div>
          <div><span>ROI</span><strong>${escapeHtml(view.roi ?? "")}</strong></div>
          <div><span>Value / cost</span><strong>${escapeHtml(view.valueToCost ?? "")}</strong></div>
        </div>`
      : "";

  const workItems = view.lines.length
    ? view.lines
        .map((line) => {
          const detail = [
            `${line.units} completed`,
            line.aiRuntime ? `${line.aiRuntime} AI` : undefined,
            line.valueGroupLabel,
          ]
            .filter((part): part is string => part !== undefined)
            .join(" · ");
          return `<div class="work-item"><span>${escapeHtml(line.label)}<small>${escapeHtml(
            detail,
          )}</small></span><strong>${escapeHtml(line.dollars)}</strong></div>`;
        })
        .join("")
    : `<p class="notice">${escapeHtml(view.emptyMessage ?? "No completed work in this period.")}</p>`;

  const attention = view.attentionMessage
    ? `<div class="notice">${escapeHtml(view.attentionMessage)}</div>`
    : "";

  const operator =
    view.exceptions !== undefined
      ? `<section class="operator">
          <strong>Operator details</strong>
          <p>Exceptions: ${view.exceptions} (${view.unresolvedExceptions ?? 0} unresolved) · Approvals: ${view.approvalsRequested ?? 0}</p>
          ${
            view.evidenceIssues && view.evidenceIssues.length > 0
              ? `<ul>${view.evidenceIssues
                  .map((issue) => `<li>${escapeHtml(issue)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </section>`
      : "";

  return `
<div class="shell">
  <div class="bar"><span>weekly-value.dashboard</span><span>${escapeHtml(
    view.modeLabel,
  )}</span><span>${escapeHtml(view.periodBadge)}</span></div>
  <div class="body">
    <header class="head">
      <div>
        <span class="eyebrow">This week</span>
        <h2>${escapeHtml(view.accountName)}</h2>
        <p class="meta">${escapeHtml(view.periodLabel)}</p>
      </div>
      <div class="badges">
        <span class="badge badge--live">${escapeHtml(view.periodBadge)}</span>
        <span class="badge">${escapeHtml(view.statusLabel)}</span>
      </div>
    </header>
  ${attention}
    <div class="hero">
      <div class="hero-card"><span>${escapeHtml(view.hoursHeroLabel)}</span><strong>${escapeHtml(
        view.hoursHero,
      )}</strong></div>
      <div class="hero-card"><span>${escapeHtml(view.dollarsHeroLabel)}</span><strong>${escapeHtml(
        view.dollarsHero,
      )}</strong></div>
    </div>
    ${delta}
    <div class="usage">
      <div><span>Work completed</span><strong>${view.usageCompletedOutcomes}</strong></div>
      <div><span>AI runtime</span><strong>${escapeHtml(view.usageAiRuntime)}</strong></div>
    </div>
    ${roiStrip}
    <section class="work"><h3>By workflow</h3>${workItems}</section>
    ${operator}
    <footer class="footer">Updated ${escapeHtml(view.generatedAt)} · Snapshot ${escapeHtml(
      view.snapshotHash.slice(0, 10),
    )}…</footer>
  </div>
</div>`;
}
