import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  estimateScorecard,
  toDashboardViewModel,
  type ScorecardSnapshot,
} from "../src/index.js";

const snapshotPath = fileURLToPath(
  new URL("../fixtures/golden-v1.expected.json", import.meta.url),
);
const expectedPath = fileURLToPath(
  new URL("../fixtures/golden-dashboard-view.expected.json", import.meta.url),
);

const goldenSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as ScorecardSnapshot;
const expectedDashboard = JSON.parse(readFileSync(expectedPath, "utf8"));

describe("toDashboardViewModel", () => {
  it("matches the cross-language golden fixture for measured runtime", () => {
    const view = toDashboardViewModel(goldenSnapshot, {
      accountName: "Demo account",
      periodState: "open",
    });
    expect(view).toEqual(expectedDashboard);
  });

  it("labels unmeasured runtime as manual hours replaced", () => {
    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        {
          workflowKey: "support",
          label: "Support triage",
          manualMinutes: 30,
          units: 2,
        },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "10000" },
    });
    const view = toDashboardViewModel(snapshot);
    expect(view.hoursHeroLabel).toBe("Manual hours replaced");
    expect(view.hoursHero).toBe("1 hr");
    expect(view.usageAiRuntime).toBe("Not measured");
  });

  it("computes deltas against a previous snapshot", () => {
    const previous = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        {
          workflowKey: "support",
          label: "Support triage",
          manualMinutes: 30,
          units: 1,
          aiDurationMs: 60_000,
        },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "10000" },
    });
    const current = estimateScorecard({
      period: { start: "2026-08-08T00:00:00.000Z", end: "2026-08-15T00:00:00.000Z" },
      generatedAt: "2026-08-15T08:00:00.000Z",
      workflows: [
        {
          workflowKey: "support",
          label: "Support triage",
          manualMinutes: 30,
          units: 2,
          aiDurationMs: 120_000,
        },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "10000" },
    });
    const view = toDashboardViewModel(current, { previousSnapshot: previous });
    expect(view.delta?.dollarsSaved).toMatch(/^\+/);
    expect(view.delta?.hoursSaved).toMatch(/^\+/);
  });

  it("shows sealed badge and empty week message", () => {
    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [],
      valuation: { currency: "USD", hourlyValueMinor: "10000" },
    });
    const view = toDashboardViewModel(snapshot, { periodState: "sealed" });
    expect(view.periodBadge).toBe("Sealed");
    expect(view.emptyMessage).toBe("No completed work this week yet");
  });
});
