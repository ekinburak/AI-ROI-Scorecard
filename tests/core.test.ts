import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EstimateInputSchema,
  GenerationInputSchema,
  MAX_DERIVED_INTEGER_STRING_LENGTH,
  MAX_ESTIMATE_WORKFLOWS,
  MAX_GENERATION_EVENTS,
  MAX_GENERATION_POLICIES,
  MAX_IDENTIFIER_LENGTH,
  MAX_INPUT_INTEGER,
  MAX_INTEGER_STRING_LENGTH,
  MAX_TRANSLATIONS,
  RENDERER_VERSION,
  canonicalJson,
  estimateScorecard,
  generateScorecard,
  renderReport,
  renderTextReport,
  sha256Canonical,
} from "../src/index.js";

const fixturePath = fileURLToPath(new URL("../fixtures/golden-v1.input.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
const expectedPath = fileURLToPath(new URL("../fixtures/golden-v2.expected.json", import.meta.url));
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Record<string, unknown>;

describe("scorecard generation", () => {
  it("uses effective account policy precedence and counts retry runtime once per attempt", () => {
    const snapshot = generateScorecard(fixture);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.totals).toMatchObject({
      completedOutcomes: 3,
      manualMinutes: "165",
      aiDurationMs: "3500",
      timeSavedMs: "9896500",
      estimatedValueMinor: "27500",
      serviceCostMinor: "25000",
      netValueMinor: "2500",
      roiBasisPoints: "1000",
      valueToCostBasisPoints: "11000",
      exceptions: 1,
      unresolvedExceptions: 0,
      approvalsRequested: 1,
    });
    expect(snapshot.lineItems.find((line) => line.policyKey === "reply-draft")).toMatchObject({
      policyVersion: 2,
      manualMinutes: "75",
      aiDurationMs: "2300",
    });
    expect(snapshot.snapshotHash).toHaveLength(64);
    expect(snapshot).toEqual(expected);
    expect(generateScorecard(fixture)).toEqual(snapshot);
  });

  it("rounds value half-up at line-item level", () => {
    const snapshot = estimateScorecard({
      accountId: "rounding-demo",
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        { workflowKey: "a", label: "A", manualMinutes: 1, units: 1, aiDurationMs: 1 },
        { workflowKey: "b", label: "B", manualMinutes: 1, units: 1, aiDurationMs: 1 },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "30" },
    });
    expect(snapshot.lineItems.map((line) => line.estimatedValueMinor)).toEqual(["1", "1"]);
    expect(snapshot.totals.estimatedValueMinor).toBe("2");
  });

  it("supports team value rates without inventing unmeasured AI runtime", () => {
    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        {
          workflowKey: "support",
          label: "Support work",
          manualMinutes: 60,
          units: 1,
          valueGroupKey: "customer-support",
          valueGroupLabel: "Customer support",
          hourlyValueMinor: "15000",
        },
        {
          workflowKey: "operations",
          label: "Operations work",
          manualMinutes: 120,
          units: 1,
          valueGroupKey: "operations",
          valueGroupLabel: "Operations",
          hourlyValueMinor: "8000",
        },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "10000" },
    });
    expect(snapshot.totals.estimatedValueMinor).toBe("31000");
    expect(snapshot.runtimeMeasurement).toBe("not_provided");
    expect(snapshot.lineItems[0]).toMatchObject({
      valueGroupLabel: "Customer support",
      hourlyValueMinor: "15000",
      runtimeMeasurement: "not_provided",
    });
    const report = renderReport(snapshot);
    expect(report.text).toContain("AI runtime: Not measured");
    expect(report.text).toContain("Manual hours replaced:");
    expect(report.text).not.toContain("AI runtime: 0 sec");
    const valueFocusedReport = renderReport(snapshot, { includeRuntime: false });
    expect(valueFocusedReport.text).not.toContain("AI runtime");
    expect(valueFocusedReport.text).not.toContain("Time difference");
    expect(valueFocusedReport.html).not.toContain("<th>AI</th>");
    expect(valueFocusedReport.text).toContain("Support work: 1 completed · 1 hr manual · $150.00");
  });

  it("preserves negative ROI and omits ratios without a positive same-period cost", () => {
    const base = {
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        { workflowKey: "task", label: "Task", manualMinutes: 60, units: 1, aiDurationMs: 1000 },
      ],
    };
    const negative = estimateScorecard({
      ...base,
      valuation: { currency: "USD", hourlyValueMinor: "1000", serviceCostMinor: "2000" },
    });
    expect(negative.totals.netValueMinor).toBe("-1000");
    expect(negative.totals.roiBasisPoints).toBe("-5000");

    const omitted = estimateScorecard({
      ...base,
      valuation: { currency: "USD", hourlyValueMinor: "1000", serviceCostMinor: "0" },
    });
    expect(omitted.totals.roiBasisPoints).toBeUndefined();
    expect(omitted.totals.valueToCostBasisPoints).toBeUndefined();
  });

  it("treats the period as half-open and corrections as append-only voids", () => {
    const input = structuredClone(fixture) as any;
    input.events.push({
      ...input.events[2],
      eventId: "event-boundary",
      outcomeId: "boundary-outcome",
      occurredAt: input.period.end,
      sequence: "12",
    });
    input.events.push({
      ...input.events[2],
      type: "correction_appended",
      eventId: "event-correction",
      occurredAt: "2026-08-28T07:00:00.000Z",
      sequence: "13",
      targetEventId: "event-03",
      action: "void",
      reason: "Duplicate completion",
    });
    delete input.events[12].outcomeId;
    delete input.events[12].units;
    const snapshot = generateScorecard(input);
    expect(snapshot.totals.completedOutcomes).toBe(1);
    expect(snapshot.totals.manualMinutes).toBe("75");
  });

  it("marks incomplete runtime evidence as needs attention", () => {
    const input = structuredClone(fixture) as any;
    input.events = input.events.filter((event: any) => event.eventId !== "event-02");
    const snapshot = generateScorecard(input);
    expect(snapshot.status).toBe("needs_attention");
    expect(snapshot.runtimeMeasurement).toBe("partial");
    expect(snapshot.evidenceIssues.join(" ")).toContain("no finish event");
  });

  it("rejects incomplete lifecycles and accepts measured abandoned attempts", () => {
    const withoutStart = structuredClone(fixture) as any;
    withoutStart.events = withoutStart.events.filter((event: any) => event.eventId !== "event-01");
    expect(generateScorecard(withoutStart).evidenceIssues.join(" ")).toContain("no start event");

    const withoutOutcome = structuredClone(fixture) as any;
    withoutOutcome.events = withoutOutcome.events.filter((event: any) => event.eventId !== "event-03");
    expect(generateScorecard(withoutOutcome).evidenceIssues.join(" ")).toContain(
      "must have one completed outcome",
    );

    const withoutException = structuredClone(fixture) as any;
    withoutException.events = withoutException.events.filter((event: any) => event.eventId !== "event-06");
    expect(generateScorecard(withoutException).evidenceIssues.join(" ")).toContain(
      "has no exception evidence",
    );

    const abandoned = structuredClone(fixture) as any;
    abandoned.events.find((event: any) => event.eventId === "event-05").status = "abandoned";
    expect(generateScorecard(abandoned).status).toBe("ready");
  });

  it("does not double-value a duplicated durable outcome", () => {
    const input = structuredClone(fixture) as any;
    input.events.push({ ...input.events[2], eventId: "duplicate-outcome", sequence: "14" });
    const snapshot = generateScorecard(input);
    expect(snapshot.status).toBe("needs_attention");
    expect(snapshot.totals.completedOutcomes).toBe(3);
    expect(snapshot.evidenceIssues.join(" ")).toContain("recorded more than once");
  });

  it("compares offset timestamps as instants and keeps runtime on its policy line", () => {
    const input = structuredClone(fixture) as any;
    for (const event of input.events) event.workflowKey = "support-automation";
    input.events.push(
      {
        ...input.events[0],
        eventId: "offset-start",
        attemptId: "offset-attempt",
        occurredAt: "2026-08-21T02:29:58.000+03:00",
        sequence: "20",
      },
      {
        ...input.events[1],
        eventId: "offset-finish",
        attemptId: "offset-attempt",
        occurredAt: "2026-08-21T02:29:59.000+03:00",
        sequence: "21",
      },
      {
        ...input.events[2],
        eventId: "offset-outcome",
        outcomeId: "offset-outcome",
        attemptId: "offset-attempt",
        occurredAt: "2026-08-21T02:29:59.000+03:00",
        sequence: "22",
      },
    );
    const snapshot = generateScorecard(input);
    expect(snapshot.totals.completedOutcomes).toBe(3);
    expect(snapshot.lineItems.find((line) => line.policyKey === "ticket-triage")?.aiDurationMs).toBe(
      "1200",
    );
    expect(snapshot.lineItems.find((line) => line.policyKey === "reply-draft")?.aiDurationMs).toBe(
      "2300",
    );
  });
});

describe("input limits", () => {
  it("accepts collection maxima and rejects oversized collections", () => {
    const input = structuredClone(fixture) as any;
    input.events = Array(MAX_GENERATION_EVENTS).fill(input.events[0]);
    input.policies = Array(MAX_GENERATION_POLICIES).fill(input.policies[0]);
    expect(GenerationInputSchema.parse(input).events).toHaveLength(MAX_GENERATION_EVENTS);

    input.events.push(input.events[0]);
    expect(GenerationInputSchema.safeParse(input).success).toBe(false);
    input.events.pop();
    input.policies.push(input.policies[0]);
    expect(GenerationInputSchema.safeParse(input).success).toBe(false);

    const workflow = {
      workflowKey: "support",
      label: "Support",
      manualMinutes: 1,
    };
    const estimate = {
      period: input.period,
      generatedAt: input.generatedAt,
      workflows: Array(MAX_ESTIMATE_WORKFLOWS).fill(workflow),
      valuation: input.valuation,
    };
    expect(EstimateInputSchema.parse(estimate).workflows).toHaveLength(MAX_ESTIMATE_WORKFLOWS);
    estimate.workflows.push(workflow);
    expect(EstimateInputSchema.safeParse(estimate).success).toBe(false);
  });

  it("rejects oversized scalar and translation inputs", () => {
    const longIdentifier = structuredClone(fixture) as any;
    longIdentifier.accountId = "a".repeat(MAX_IDENTIFIER_LENGTH + 1);
    expect(GenerationInputSchema.safeParse(longIdentifier).success).toBe(false);

    const hugeInteger = structuredClone(fixture) as any;
    hugeInteger.valuation.hourlyValueMinor = "9".repeat(MAX_INTEGER_STRING_LENGTH + 1);
    expect(GenerationInputSchema.safeParse(hugeInteger).success).toBe(false);

    const translations = structuredClone(fixture) as any;
    translations.policies[0].label.translations = Object.fromEntries(
      Array.from({ length: MAX_TRANSLATIONS + 1 }, (_, index) => [`x-${index}`, "Label"]),
    );
    expect(GenerationInputSchema.safeParse(translations).success).toBe(false);

    const numeric = structuredClone(fixture) as any;
    numeric.events[1].activeDurationMs = MAX_INPUT_INTEGER + 1;
    expect(GenerationInputSchema.safeParse(numeric).success).toBe(false);
  });

  it("keeps maximum accepted numeric inputs inside derived output limits", () => {
    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        {
          workflowKey: "maximum",
          label: "Maximum",
          manualMinutes: MAX_INPUT_INTEGER,
          units: MAX_INPUT_INTEGER,
        },
      ],
      valuation: {
        currency: "USD",
        hourlyValueMinor: "9".repeat(MAX_INTEGER_STRING_LENGTH),
        serviceCostMinor: "1",
      },
    });
    expect(snapshot.totals.estimatedValueMinor.length).toBeLessThanOrEqual(
      MAX_DERIVED_INTEGER_STRING_LENGTH,
    );
    expect(snapshot.totals.roiBasisPoints?.length).toBeLessThanOrEqual(
      MAX_DERIVED_INTEGER_STRING_LENGTH,
    );
  });
});

describe("canonical reports", () => {
  it("sorts object keys and hashes deterministically", () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 3 }, n: 10n })).toBe(
      '{"a":{"b":3,"d":2},"n":"10","z":1}',
    );
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(sha256Canonical({ a: 1, b: 2 }));
  });

  it("escapes report content and keeps HTML/text values aligned", () => {
    const input = structuredClone(fixture) as any;
    input.policies[0].label.default = '<script>alert("x")</script>';
    const snapshot = generateScorecard(input);
    const report = renderReport(snapshot, { accountName: "Demo & Co" });
    expect(report.html).not.toContain("<script>alert");
    expect(report.html).toContain("&lt;script&gt;");
    expect(report.html).toContain("Demo &amp; Co");
    expect(report.text).toContain(snapshot.totals.estimatedValueMinor === "27500" ? "$275.00" : "");
    expect(report.artifactHash).toHaveLength(64);
  });

  it("encodes unsafe plain-text controls without changing printable Unicode or HTML escaping", () => {
    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [{ workflowKey: "task", label: "Task", manualMinutes: 1 }],
      valuation: { currency: "USD", hourlyValueMinor: "100" },
    });
    const forged = structuredClone(snapshot) as any;
    forged.lineItems[0].label = "<unsafe> مرحبا שלום\nSnapshot: forged\u001b]8;;https://example.test\u0007";
    forged.evidenceIssues = ["Issue\r\nEstimated value: forged\u009B31m\u202E"];
    const options = {
      title: "Title\u2028Approvals requested: 999",
      accountName: "Account\tInjected",
      locale: "ar",
    };
    const text = renderTextReport(forged, options);
    const report = renderReport(forged, options);

    expect(RENDERER_VERSION).toBe("2.0.0");
    const unsafeControl = [...text].find((character) => {
      const codePoint = character.codePointAt(0) ?? -1;
      return (
        codePoint <= 0x0009 ||
        (codePoint >= 0x000b && codePoint <= 0x001f) ||
        (codePoint >= 0x007f && codePoint <= 0x009f) ||
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    });
    expect(unsafeControl).toBeUndefined();
    expect(text).toContain("مرحبا שלום");
    expect(text).toContain("\\u000A");
    expect(text).toContain("\\u001B");
    expect(text).toContain("\\u202E");
    expect(report.text).toBe(text);
    expect(report.html).toContain("&lt;unsafe&gt; مرحبا שלום");
  });
});
