import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  estimateScorecard,
  generateScorecard,
  renderReport,
  sha256Canonical,
} from "../src/index.js";

const fixturePath = fileURLToPath(new URL("../fixtures/golden-v1.input.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
const expectedPath = fileURLToPath(new URL("../fixtures/golden-v1.expected.json", import.meta.url));
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
    expect(snapshot.evidenceIssues.join(" ")).toContain("no measured finish");
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
});
