import { formatDuration, formatMoney } from "./format.js";
import {
  ScorecardSnapshotSchema,
  type ScorecardSnapshot,
} from "./schemas.js";

export type DashboardAudience = "cfo" | "operator";
export type DashboardPeriodState = "open" | "sealed";

export interface DashboardOptions {
  accountName?: string;
  audience?: DashboardAudience;
  deltaLabel?: string;
  locale?: string;
  periodState?: DashboardPeriodState;
  previousSnapshot?: ScorecardSnapshot;
}

export interface DashboardLineViewModel {
  label: string;
  units: number;
  hours: string;
  dollars: string;
  aiRuntime?: string;
  valueGroupLabel?: string;
}

export interface DashboardDeltaViewModel {
  dollarsSaved?: string;
  hoursSaved?: string;
  label: string;
}

export interface DashboardViewModel {
  accountName: string;
  attentionMessage?: string;
  approvalsRequested?: number;
  delta?: DashboardDeltaViewModel;
  dollarsHero: string;
  dollarsHeroLabel: string;
  emptyMessage?: string;
  evidenceIssues?: string[];
  exceptions?: number;
  generatedAt: string;
  hoursHero: string;
  hoursHeroLabel: string;
  lines: DashboardLineViewModel[];
  modeLabel: string;
  netValue?: string;
  periodBadge: string;
  periodLabel: string;
  periodState: DashboardPeriodState;
  roi?: string;
  runtimeMeasurement: ScorecardSnapshot["runtimeMeasurement"];
  serviceCost?: string;
  snapshotHash: string;
  status: ScorecardSnapshot["status"];
  statusLabel: string;
  unresolvedExceptions?: number;
  usageAiRuntime: string;
  usageCompletedOutcomes: number;
  valueToCost?: string;
}

function formatPeriod(snapshot: ScorecardSnapshot, locale: string): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return `${date.format(new Date(snapshot.period.start))} – ${date.format(
    new Date(snapshot.period.end),
  )}`;
}

function formatDeltaDuration(deltaMs: bigint, locale: string): string {
  const sign = deltaMs < 0n ? "−" : "+";
  const absolute = deltaMs < 0n ? -deltaMs : deltaMs;
  return `${sign}${formatDuration(absolute.toString(), locale)}`;
}

function formatDeltaMoney(deltaMinor: bigint, currency: string, scale: number, locale: string): string {
  const sign = deltaMinor < 0n ? "−" : "+";
  const absolute = deltaMinor < 0n ? -deltaMinor : deltaMinor;
  return `${sign}${formatMoney(absolute.toString(), currency, scale, locale)}`;
}

export function toDashboardViewModel(
  snapshotInput: ScorecardSnapshot,
  options: DashboardOptions = {},
): DashboardViewModel {
  const snapshot = ScorecardSnapshotSchema.parse(snapshotInput);
  const locale = options.locale ?? snapshot.locale;
  const audience = options.audience ?? "cfo";
  const periodState = options.periodState ?? "open";
  const money = (minor: string) =>
    formatMoney(minor, snapshot.currency, snapshot.currencyMinorUnitScale, locale);

  const runtimeMeasured = snapshot.runtimeMeasurement === "measured";
  const manualDurationMs = (BigInt(snapshot.totals.manualMinutes) * 60_000n).toString();

  const hoursHeroLabel = runtimeMeasured ? "Hours saved" : "Manual hours replaced";
  const hoursHero = runtimeMeasured
    ? formatDuration(snapshot.totals.timeSavedMs ?? "0", locale)
    : formatDuration(manualDurationMs, locale);

  const usageAiRuntime =
    snapshot.runtimeMeasurement === "measured"
      ? formatDuration(snapshot.totals.aiDurationMs, locale)
      : snapshot.runtimeMeasurement === "partial"
        ? "Partially measured"
        : "Not measured";

  const roi = snapshot.totals.roiBasisPoints;
  const multiple = snapshot.totals.valueToCostBasisPoints;

  let delta: DashboardDeltaViewModel | undefined;
  if (options.previousSnapshot) {
    const previous = ScorecardSnapshotSchema.parse(options.previousSnapshot);
    const deltaLabel = options.deltaLabel ?? "vs last week";
    const hoursDelta =
      runtimeMeasured && previous.runtimeMeasurement === "measured"
        ? formatDeltaDuration(
            BigInt(snapshot.totals.timeSavedMs ?? "0") - BigInt(previous.totals.timeSavedMs ?? "0"),
            locale,
          )
        : undefined;
    const dollarsDelta = formatDeltaMoney(
      BigInt(snapshot.totals.estimatedValueMinor) -
        BigInt(previous.totals.estimatedValueMinor),
      snapshot.currency,
      snapshot.currencyMinorUnitScale,
      locale,
    );
    delta = {
      label: deltaLabel,
      ...(hoursDelta === undefined ? {} : { hoursSaved: hoursDelta }),
      dollarsSaved: dollarsDelta,
    };
  }

  const emptyMessage =
    snapshot.status === "send_not_recommended"
      ? "No completed work this week yet"
      : undefined;

  const attentionMessage =
    snapshot.status === "needs_attention"
      ? "Some evidence needs attention before this report is complete"
      : undefined;

  const operatorFields: Pick<
    DashboardViewModel,
    "exceptions" | "unresolvedExceptions" | "approvalsRequested" | "evidenceIssues"
  > = {};
  if (audience === "operator") {
    operatorFields.exceptions = snapshot.totals.exceptions;
    operatorFields.unresolvedExceptions = snapshot.totals.unresolvedExceptions;
    operatorFields.approvalsRequested = snapshot.totals.approvalsRequested;
    if (snapshot.evidenceIssues.length > 0) {
      operatorFields.evidenceIssues = snapshot.evidenceIssues;
    }
  }

  return {
    accountName: options.accountName ?? snapshot.accountId,
    periodLabel: formatPeriod(snapshot, locale),
    periodState,
    periodBadge: periodState === "open" ? "Live" : "Sealed",
    modeLabel:
      snapshot.mode === "illustrative" ? "Illustrative estimate" : "Evidence-backed report",
    status: snapshot.status,
    statusLabel: snapshot.status.replaceAll("_", " "),
    runtimeMeasurement: snapshot.runtimeMeasurement,
    hoursHeroLabel,
    hoursHero,
    dollarsHeroLabel: "Estimated dollars saved",
    dollarsHero: money(snapshot.totals.estimatedValueMinor),
    usageCompletedOutcomes: snapshot.totals.completedOutcomes,
    usageAiRuntime,
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
    lines: snapshot.lineItems.map((line) => ({
      label: line.label,
      units: line.units,
      hours: formatDuration((BigInt(line.manualMinutes) * 60_000n).toString(), locale),
      dollars: money(line.estimatedValueMinor),
      ...(line.runtimeMeasurement === "measured"
        ? { aiRuntime: formatDuration(line.aiDurationMs, locale) }
        : {}),
      ...(line.valueGroupLabel === null ? {} : { valueGroupLabel: line.valueGroupLabel }),
    })),
    ...(emptyMessage === undefined ? {} : { emptyMessage }),
    ...(attentionMessage === undefined ? {} : { attentionMessage }),
    ...(delta === undefined ? {} : { delta }),
    generatedAt: snapshot.generatedAt,
    snapshotHash: snapshot.snapshotHash,
    ...operatorFields,
  };
}
