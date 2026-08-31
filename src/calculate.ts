import { canonicalJson, sha256Canonical } from "./canonical.js";
import {
  EstimateInputSchema,
  GenerationInputSchema,
  SCHEMA_VERSION,
  ScorecardSnapshotSchema,
  type EvidenceEvent,
  type ScorecardLineItem,
  type ScorecardSnapshot,
  type ValuePolicy,
} from "./schemas.js";

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

function isWithin(occurredAt: string, start: string, end: string): boolean {
  const instant = Date.parse(occurredAt);
  return instant >= Date.parse(start) && instant < Date.parse(end);
}

function compareEvidence(left: EvidenceEvent, right: EvidenceEvent): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    const sequenceDifference = BigInt(left.sequence) - BigInt(right.sequence);
    if (sequenceDifference !== 0n) return sequenceDifference < 0n ? -1 : 1;
  }
  const timeDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return timeDifference || (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0);
}

function selectedPolicy(
  policies: ValuePolicy[],
  accountId: string,
  policyKey: string,
  occurredAt: string,
): ValuePolicy | undefined {
  return policies
    .filter(
      (policy) =>
        policy.policyKey === policyKey &&
        Date.parse(policy.effectiveFrom) <= Date.parse(occurredAt) &&
        (!policy.effectiveTo || Date.parse(occurredAt) < Date.parse(policy.effectiveTo)) &&
        (policy.scope === "default" || policy.accountId === accountId),
    )
    .sort((left, right) => {
      const scopeDifference = Number(right.scope === "account") - Number(left.scope === "account");
      if (scopeDifference) return scopeDifference;
      const effectiveDifference = Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
      return effectiveDifference || right.version - left.version;
    })[0];
}

function localizedLabel(policy: ValuePolicy, locale: string): string {
  return policy.label.translations[locale] ?? policy.label.default;
}

function withHash(snapshot: Omit<ScorecardSnapshot, "snapshotHash">): ScorecardSnapshot {
  return ScorecardSnapshotSchema.parse({
    ...snapshot,
    snapshotHash: sha256Canonical(snapshot),
  });
}

function costMetrics(estimatedValue: bigint, serviceCostMinor?: string) {
  if (serviceCostMinor === undefined || BigInt(serviceCostMinor) === 0n) return {};
  const cost = BigInt(serviceCostMinor);
  const net = estimatedValue - cost;
  return {
    serviceCostMinor,
    netValueMinor: net.toString(),
    roiBasisPoints: roundHalfUp(net * 10_000n, cost).toString(),
    valueToCostBasisPoints: roundHalfUp(estimatedValue * 10_000n, cost).toString(),
  };
}

export function generateScorecard(input: unknown): ScorecardSnapshot {
  const parsed = GenerationInputSchema.parse(input);
  const sortedEvents = [...parsed.events].sort(compareEvidence);
  const evidenceIssues: string[] = [];
  const uniqueEventsById = new Map<string, EvidenceEvent>();
  for (const event of sortedEvents) {
    if (Date.parse(event.occurredAt) > Date.parse(parsed.generatedAt)) {
      evidenceIssues.push(`Event ${event.eventId} occurred after snapshot generation.`);
      continue;
    }
    const existing = uniqueEventsById.get(event.eventId);
    if (!existing) uniqueEventsById.set(event.eventId, event);
    else if (canonicalJson(existing) !== canonicalJson(event)) {
      evidenceIssues.push(`Event ${event.eventId} has conflicting payloads.`);
    }
  }
  const uniqueEvents = [...uniqueEventsById.values()];
  const voidedEventIds = new Set(
    uniqueEvents.flatMap((event) => {
      if (event.type !== "correction_appended") return [];
      const target = uniqueEventsById.get(event.targetEventId);
      if (!target || target.type === "correction_appended") {
        evidenceIssues.push(`Correction ${event.eventId} targets invalid evidence.`);
        return [];
      }
      return [event.targetEventId];
    }),
  );
  const activeEvents = uniqueEvents.filter((event) => !voidedEventIds.has(event.eventId));
  const periodEvents = activeEvents.filter((event) =>
    isWithin(event.occurredAt, parsed.period.start, parsed.period.end),
  );
  const starts = activeEvents.filter((event) => event.type === "attempt_started");
  const finishes = activeEvents.filter((event) => event.type === "attempt_finished");
  const outcomes = periodEvents.filter((event) => event.type === "outcome_completed");
  const exceptionEvents = periodEvents.filter((event) => event.type === "exception_recorded");
  const uniqueOutcomes = outcomes.filter(
    (event, index) => outcomes.findIndex((candidate) => candidate.outcomeId === event.outcomeId) === index,
  );
  for (const outcome of uniqueOutcomes) {
    if (outcomes.filter((candidate) => candidate.outcomeId === outcome.outcomeId).length > 1) {
      evidenceIssues.push(`Outcome ${outcome.outcomeId} was recorded more than once.`);
    }
  }
  for (const start of periodEvents.filter((event) => event.type === "attempt_started")) {
    const matching = finishes.filter((finish) => finish.attemptId === start.attemptId);
    if (matching.length === 0) evidenceIssues.push(`Attempt ${start.attemptId} has no measured finish event.`);
    if (matching.length > 1) evidenceIssues.push(`Attempt ${start.attemptId} has multiple finish events.`);
  }
  for (const finish of periodEvents.filter((event) => event.type === "attempt_finished")) {
    const matchingStarts = starts.filter((start) => start.attemptId === finish.attemptId);
    if (matchingStarts.length === 0) evidenceIssues.push(`Attempt ${finish.attemptId} has no start event.`);
    if (matchingStarts.length > 1) evidenceIssues.push(`Attempt ${finish.attemptId} has multiple start events.`);
    const attemptOutcomes = outcomes.filter((outcome) => outcome.attemptId === finish.attemptId);
    if (finish.status === "succeeded" && attemptOutcomes.length !== 1) {
      evidenceIssues.push(`Successful attempt ${finish.attemptId} must have one completed outcome.`);
    }
    if (
      finish.status !== "succeeded" &&
      !exceptionEvents.some((event) => event.attemptId === finish.attemptId)
    ) {
      evidenceIssues.push(`Unsuccessful attempt ${finish.attemptId} has no exception evidence.`);
    }
  }
  const lineMap = new Map<string, ScorecardLineItem>();

  for (const outcome of uniqueOutcomes) {
    const matchingFinishes = finishes.filter(
      (finish) =>
        finish.attemptId === outcome.attemptId &&
        finish.status === "succeeded" &&
        finish.workflowKey === outcome.workflowKey &&
        finish.policyKey === outcome.policyKey,
    );
    if (matchingFinishes.length !== 1) {
      evidenceIssues.push(`Outcome ${outcome.outcomeId} has no successful measured attempt.`);
      continue;
    }
    const policy = selectedPolicy(
      parsed.policies,
      parsed.accountId,
      outcome.policyKey,
      outcome.occurredAt,
    );
    if (!policy) {
      evidenceIssues.push(`No effective value policy exists for ${outcome.policyKey}.`);
      continue;
    }
    const manualMinutes = BigInt(policy.manualMinutesPerUnit) * BigInt(outcome.units);
    const estimatedValue = roundHalfUp(
      manualMinutes * BigInt(parsed.valuation.hourlyValueMinor),
      60n,
    );
    const key = `${outcome.workflowKey}\u0000${policy.policyKey}\u0000${policy.version}`;
    const existing = lineMap.get(key);
    if (existing) {
      existing.units += outcome.units;
      existing.manualMinutes = (BigInt(existing.manualMinutes) + manualMinutes).toString();
      existing.estimatedValueMinor = (
        BigInt(existing.estimatedValueMinor) + estimatedValue
      ).toString();
    } else {
      lineMap.set(key, {
        workflowKey: outcome.workflowKey,
        policyKey: policy.policyKey,
        policyVersion: policy.version,
        label: localizedLabel(policy, parsed.locale),
        units: outcome.units,
        manualMinutes: manualMinutes.toString(),
        aiDurationMs: "0",
        estimatedValueMinor: estimatedValue.toString(),
        evidenceLevel: policy.evidenceLevel,
      });
    }
  }

  const attemptRuntimeByLine = new Map<string, bigint>();
  let aiDurationMs = 0n;
  for (const event of periodEvents) {
    if (event.type !== "attempt_finished") continue;
    const duration = BigInt(event.activeDurationMs);
    aiDurationMs += duration;
    const runtimeKey = `${event.workflowKey}\u0000${event.policyKey}`;
    attemptRuntimeByLine.set(
      runtimeKey,
      (attemptRuntimeByLine.get(runtimeKey) ?? 0n) + duration,
    );
  }
  for (const line of lineMap.values()) {
    const runtimeKey = `${line.workflowKey}\u0000${line.policyKey}`;
    line.aiDurationMs = (attemptRuntimeByLine.get(runtimeKey) ?? 0n).toString();
  }

  const lineItems = [...lineMap.values()].sort((left, right) => {
    const leftKey = `${left.workflowKey}\u0000${left.policyKey}\u0000${left.policyVersion ?? 0}`;
    const rightKey = `${right.workflowKey}\u0000${right.policyKey}\u0000${right.policyVersion ?? 0}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const manualMinutes = lineItems.reduce(
    (total, line) => total + BigInt(line.manualMinutes),
    0n,
  );
  const estimatedValue = lineItems.reduce(
    (total, line) => total + BigInt(line.estimatedValueMinor),
    0n,
  );
  const allExceptionIds = new Set(
    activeEvents
      .filter((event) => event.type === "exception_recorded")
      .map((event) => event.exceptionId),
  );
  const resolutions = activeEvents.filter((event) => event.type === "resolution_recorded");
  for (const resolution of resolutions) {
    if (!allExceptionIds.has(resolution.exceptionId)) {
      evidenceIssues.push(`Resolution ${resolution.eventId} has no recorded exception.`);
    }
    if (resolutions.filter((event) => event.exceptionId === resolution.exceptionId).length > 1) {
      evidenceIssues.push(`Exception ${resolution.exceptionId} has multiple resolutions.`);
    }
  }
  const resolvedExceptionIds = new Set(
    resolutions.map((event) => event.exceptionId),
  );
  const unresolvedExceptions = exceptionEvents.filter(
    (event) => !resolvedExceptionIds.has(event.exceptionId),
  ).length;
  const approvalsRequested = periodEvents.filter(
    (event) => event.type === "approval_requested",
  ).length;
  const completedOutcomes = lineItems.reduce((total, line) => total + line.units, 0);
  const status =
    evidenceIssues.length > 0
      ? "needs_attention"
      : completedOutcomes === 0
        ? "send_not_recommended"
        : "ready";
  const evidenceWatermark =
    parsed.evidenceWatermark ??
    sortedEvents.reduce<string | undefined>((highest, event) => {
      if (event.sequence === undefined) return highest;
      return highest === undefined || BigInt(event.sequence) > BigInt(highest)
        ? event.sequence
        : highest;
    }, undefined);
  const sourceFingerprint = sha256Canonical({
    accountId: parsed.accountId,
    events: sortedEvents,
    evidenceWatermark,
    period: parsed.period,
    policies: [...parsed.policies].sort((left, right) => {
      const leftKey = `${left.policyKey}:${left.scope}:${left.accountId ?? ""}:${left.version}`;
      const rightKey = `${right.policyKey}:${right.scope}:${right.accountId ?? ""}:${right.version}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    valuation: parsed.valuation,
  });

  return withHash({
    schemaVersion: SCHEMA_VERSION,
    mode: "audited",
    accountId: parsed.accountId,
    locale: parsed.locale,
    period: parsed.period,
    generatedAt: parsed.generatedAt,
    ...(evidenceWatermark === undefined ? {} : { evidenceWatermark }),
    currency: parsed.valuation.currency,
    currencyMinorUnitScale: parsed.valuation.currencyMinorUnitScale,
    status,
    lineItems,
    totals: {
      completedOutcomes,
      manualMinutes: manualMinutes.toString(),
      aiDurationMs: aiDurationMs.toString(),
      timeSavedMs: (manualMinutes * 60_000n - aiDurationMs).toString(),
      estimatedValueMinor: estimatedValue.toString(),
      ...costMetrics(estimatedValue, parsed.valuation.serviceCostMinor),
      exceptions: exceptionEvents.length,
      unresolvedExceptions,
      approvalsRequested,
    },
    evidenceIssues: [...new Set(evidenceIssues)].sort(),
    sourceFingerprint,
  });
}

export function estimateScorecard(input: unknown): ScorecardSnapshot {
  const parsed = EstimateInputSchema.parse(input);
  const lineItems = parsed.workflows.map<ScorecardLineItem>((workflow) => {
    const manualMinutes = BigInt(workflow.manualMinutes) * BigInt(workflow.units);
    return {
      workflowKey: workflow.workflowKey,
      policyKey: workflow.workflowKey,
      policyVersion: null,
      label: workflow.label,
      units: workflow.units,
      manualMinutes: manualMinutes.toString(),
      aiDurationMs: BigInt(workflow.aiDurationMs).toString(),
      estimatedValueMinor: roundHalfUp(
        manualMinutes * BigInt(parsed.valuation.hourlyValueMinor),
        60n,
      ).toString(),
      evidenceLevel: "illustrative",
    };
  });
  const manualMinutes = lineItems.reduce(
    (total, line) => total + BigInt(line.manualMinutes),
    0n,
  );
  const aiDurationMs = lineItems.reduce(
    (total, line) => total + BigInt(line.aiDurationMs),
    0n,
  );
  const estimatedValue = lineItems.reduce(
    (total, line) => total + BigInt(line.estimatedValueMinor),
    0n,
  );
  const completedOutcomes = lineItems.reduce((total, line) => total + line.units, 0);
  const sourceFingerprint = sha256Canonical({
    accountId: parsed.accountId,
    mode: "illustrative",
    period: parsed.period,
    valuation: parsed.valuation,
    workflows: parsed.workflows,
  });

  return withHash({
    schemaVersion: SCHEMA_VERSION,
    mode: "illustrative",
    accountId: parsed.accountId,
    locale: parsed.locale,
    period: parsed.period,
    generatedAt: parsed.generatedAt,
    currency: parsed.valuation.currency,
    currencyMinorUnitScale: parsed.valuation.currencyMinorUnitScale,
    status: completedOutcomes === 0 ? "send_not_recommended" : "ready",
    lineItems,
    totals: {
      completedOutcomes,
      manualMinutes: manualMinutes.toString(),
      aiDurationMs: aiDurationMs.toString(),
      timeSavedMs: (manualMinutes * 60_000n - aiDurationMs).toString(),
      estimatedValueMinor: estimatedValue.toString(),
      ...costMetrics(estimatedValue, parsed.valuation.serviceCostMinor),
      exceptions: 0,
      unresolvedExceptions: 0,
      approvalsRequested: 0,
    },
    evidenceIssues: [],
    sourceFingerprint,
  });
}

export { roundHalfUp };
