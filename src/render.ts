import { canonicalJson, sha256Canonical } from "./canonical.js";
import {
  RENDERER_VERSION,
  ScorecardSnapshotSchema,
  type ScorecardSnapshot,
} from "./schemas.js";

export interface ReportOptions {
  accountName?: string;
  locale?: string;
  title?: string;
}

export interface ReportLineViewModel {
  label: string;
  units: number;
  manualTime: string;
  aiTime: string;
  estimatedValue: string;
}

export interface ReportViewModel {
  title: string;
  accountName: string;
  period: string;
  modeLabel: string;
  status: ScorecardSnapshot["status"];
  estimatedValue: string;
  manualTime: string;
  aiTime: string;
  timeSaved: string;
  serviceCost?: string;
  netValue?: string;
  roi?: string;
  valueToCost?: string;
  exceptions: number;
  unresolvedExceptions: number;
  approvalsRequested: number;
  lines: ReportLineViewModel[];
  evidenceIssues: string[];
  snapshotHash: string;
}

export interface RenderedReport {
  html: string;
  text: string;
  rendererVersion: string;
  artifactHash: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(
  minor: string,
  currency: string,
  scale: number,
  locale: string,
): string {
  const divisor = 10n ** BigInt(scale);
  const absolute = BigInt(minor) < 0n ? -BigInt(minor) : BigInt(minor);
  const numeric = Number(absolute / divisor) + Number(absolute % divisor) / Number(divisor);
  const signed = BigInt(minor) < 0n ? -numeric : numeric;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(signed);
}

function formatDuration(milliseconds: string, locale: string): string {
  const value = BigInt(milliseconds);
  const sign = value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  const totalMinutes = Number(absolute) / 60_000;
  if (totalMinutes < 1) {
    return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      totalMinutes * 60,
    )} sec`;
  }
  if (totalMinutes < 60) {
    return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      totalMinutes,
    )} min`;
  }
  return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    totalMinutes / 60,
  )} hr`;
}

export function toReportViewModel(
  snapshotInput: ScorecardSnapshot,
  options: ReportOptions = {},
): ReportViewModel {
  const snapshot = ScorecardSnapshotSchema.parse(snapshotInput);
  const locale = options.locale ?? snapshot.locale;
  const money = (minor: string) =>
    formatMoney(minor, snapshot.currency, snapshot.currencyMinorUnitScale, locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const roi = snapshot.totals.roiBasisPoints;
  const multiple = snapshot.totals.valueToCostBasisPoints;
  return {
    title: options.title ?? "Weekly AI value scorecard",
    accountName: options.accountName ?? snapshot.accountId,
    period: `${date.format(new Date(snapshot.period.start))} – ${date.format(
      new Date(snapshot.period.end),
    )}`,
    modeLabel: snapshot.mode === "illustrative" ? "Illustrative estimate" : "Evidence-backed report",
    status: snapshot.status,
    estimatedValue: money(snapshot.totals.estimatedValueMinor),
    manualTime: formatDuration((BigInt(snapshot.totals.manualMinutes) * 60_000n).toString(), locale),
    aiTime: formatDuration(snapshot.totals.aiDurationMs, locale),
    timeSaved: formatDuration(snapshot.totals.timeSavedMs, locale),
    ...(snapshot.totals.serviceCostMinor === undefined
      ? {}
      : { serviceCost: money(snapshot.totals.serviceCostMinor) }),
    ...(snapshot.totals.netValueMinor === undefined
      ? {}
      : { netValue: money(snapshot.totals.netValueMinor) }),
    ...(roi === undefined
      ? {}
      : {
          roi: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
            Number(BigInt(roi)) / 100,
          )}%`,
        }),
    ...(multiple === undefined
      ? {}
      : {
          valueToCost: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
            Number(BigInt(multiple)) / 10_000,
          )}×`,
        }),
    exceptions: snapshot.totals.exceptions,
    unresolvedExceptions: snapshot.totals.unresolvedExceptions,
    approvalsRequested: snapshot.totals.approvalsRequested,
    lines: snapshot.lineItems.map((line) => ({
      label: line.label,
      units: line.units,
      manualTime: formatDuration((BigInt(line.manualMinutes) * 60_000n).toString(), locale),
      aiTime: formatDuration(line.aiDurationMs, locale),
      estimatedValue: money(line.estimatedValueMinor),
    })),
    evidenceIssues: snapshot.evidenceIssues,
    snapshotHash: snapshot.snapshotHash,
  };
}

export function renderTextReport(
  snapshot: ScorecardSnapshot,
  options: ReportOptions = {},
): string {
  const view = toReportViewModel(snapshot, options);
  const costLines = [
    view.serviceCost ? `Service cost: ${view.serviceCost}` : undefined,
    view.netValue ? `Net value: ${view.netValue}` : undefined,
    view.roi ? `ROI: ${view.roi}` : undefined,
    view.valueToCost ? `Value to cost: ${view.valueToCost}` : undefined,
  ].filter(Boolean);
  const workflowLines = view.lines.map(
    (line) =>
      `- ${line.label}: ${line.units} completed · ${line.manualTime} manual · ${line.aiTime} AI · ${line.estimatedValue}`,
  );
  const issueLines = view.evidenceIssues.map((issue) => `- ${issue}`);
  return [
    view.title,
    `${view.accountName} · ${view.period}`,
    view.modeLabel,
    "",
    `Estimated value: ${view.estimatedValue}`,
    `Manual time: ${view.manualTime}`,
    `AI runtime: ${view.aiTime}`,
    `Time difference: ${view.timeSaved}`,
    ...costLines,
    `Exceptions: ${view.exceptions} (${view.unresolvedExceptions} unresolved)`,
    `Approvals requested: ${view.approvalsRequested}`,
    "",
    "Work completed",
    ...(workflowLines.length ? workflowLines : ["- No completed work in this period."]),
    ...(issueLines.length ? ["", "Evidence requiring attention", ...issueLines] : []),
    "",
    `Snapshot: ${view.snapshotHash}`,
  ].join("\n");
}

export function renderHtmlReport(
  snapshot: ScorecardSnapshot,
  options: ReportOptions = {},
): string {
  const view = toReportViewModel(snapshot, options);
  const optionalMetrics = [
    view.serviceCost ? ["Service cost", view.serviceCost] : undefined,
    view.netValue ? ["Net value", view.netValue] : undefined,
    view.roi ? ["ROI", view.roi] : undefined,
    view.valueToCost ? ["Value / cost", view.valueToCost] : undefined,
  ].filter((metric): metric is string[] => metric !== undefined);
  const metric = (label: string, value: string, emphasized = false) => `
    <div class="metric${emphasized ? " metric--primary" : ""}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>
    </div>`;
  const rows = view.lines.length
    ? view.lines
        .map(
          (line) => `<tr><td>${escapeHtml(line.label)}</td><td>${line.units}</td><td>${escapeHtml(
            line.manualTime,
          )}</td><td>${escapeHtml(line.aiTime)}</td><td>${escapeHtml(line.estimatedValue)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No completed work in this period.</td></tr>`;
  const issues = view.evidenceIssues.length
    ? `<section class="issues"><h2>Evidence requiring attention</h2><ul>${view.evidenceIssues
        .map((issue) => `<li>${escapeHtml(issue)}</li>`)
        .join("")}</ul></section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(view.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f4f1;color:#171716;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}.page{max-width:960px;margin:24px auto;background:#fff;padding:38px;border:1px solid #deded8;border-radius:16px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:1px solid #e7e7e2;padding-bottom:24px}.eyebrow{color:#58766d;font-size:12px;letter-spacing:.12em;text-transform:uppercase}h1{font-size:30px;line-height:1.05;letter-spacing:-.03em;margin:7px 0 10px}p{margin:0;color:#676762}.status{font-size:12px;border:1px solid #d8d8d2;border-radius:99px;padding:6px 10px;white-space:nowrap}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#deded8;margin:28px 0;border:1px solid #deded8;border-radius:12px;overflow:hidden}.metric{background:#f8f8f5;padding:16px;min-height:88px}.metric span{display:block;color:#73736e;font-size:12px;margin-bottom:10px}.metric strong{font-size:20px;font-weight:600}.metric--primary{background:#171716;color:#faf9f6}.metric--primary span{color:#aaa9a3}h2{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #ecece7}th{color:#73736e;font-size:11px;text-transform:uppercase;letter-spacing:.08em}th:last-child,td:last-child{text-align:right}.summary{display:flex;gap:24px;margin-top:22px;padding:16px;background:#f8f8f5;border-radius:10px}.summary strong{display:block;font-size:17px}.summary span{color:#73736e;font-size:12px}.issues{margin-top:22px;padding:16px;border:1px solid #d8d8d2;border-radius:10px}.issues li{margin:5px 0}footer{margin-top:24px;color:#8a8a84;font:11px ui-monospace,monospace;word-break:break-all}@media(max-width:720px){.page{margin:0;padding:22px;border-radius:0}.metrics{grid-template-columns:1fr 1fr}header{flex-direction:column}.table-wrap{overflow:auto}.summary{flex-wrap:wrap}}@media print{body{background:#fff}.page{margin:0;max-width:none;border:0;padding:20px}.metrics{break-inside:avoid}}
</style></head><body><main class="page"><header><div><div class="eyebrow">${escapeHtml(
    view.modeLabel,
  )}</div><h1>${escapeHtml(view.title)}</h1><p>${escapeHtml(view.accountName)} · ${escapeHtml(
    view.period,
  )}</p></div><div class="status">${escapeHtml(view.status.replaceAll("_", " "))}</div></header>
<section class="metrics">${metric("Estimated value", view.estimatedValue, true)}${metric(
    "Manual time",
    view.manualTime,
  )}${metric("AI runtime", view.aiTime)}${metric("Time difference", view.timeSaved)}${optionalMetrics
    .map(([label, value]) => metric(label ?? "", value ?? ""))
    .join("")}</section>
<section><h2>Work completed</h2><div class="table-wrap"><table><thead><tr><th>Workflow</th><th>Completed</th><th>Manual</th><th>AI</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="summary"><div><strong>${view.exceptions}</strong><span>Exceptions</span></div><div><strong>${view.unresolvedExceptions}</strong><span>Unresolved</span></div><div><strong>${view.approvalsRequested}</strong><span>Human approvals</span></div></section>${issues}
<footer>Snapshot ${escapeHtml(view.snapshotHash)}</footer></main></body></html>`;
}

export function renderReport(
  snapshot: ScorecardSnapshot,
  options: ReportOptions = {},
): RenderedReport {
  const html = renderHtmlReport(snapshot, options);
  const text = renderTextReport(snapshot, options);
  return {
    html,
    text,
    rendererVersion: RENDERER_VERSION,
    artifactHash: sha256Canonical({ html, rendererVersion: RENDERER_VERSION, text }),
  };
}

export function exportSnapshotJson(snapshot: ScorecardSnapshot): string {
  return canonicalJson(ScorecardSnapshotSchema.parse(snapshot));
}
