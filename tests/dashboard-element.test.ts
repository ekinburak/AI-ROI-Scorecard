// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeEach } from "vitest";

import {
  AI_ROI_DASHBOARD_TAG,
  type AiRoiDashboardElement,
  registerAiRoiDashboard,
} from "../src/dashboard/index.js";
import type { ScorecardSnapshot } from "../src/schemas.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldenSnapshot = JSON.parse(
  readFileSync(join(rootDir, "fixtures/golden-v1.expected.json"), "utf8"),
) as ScorecardSnapshot;

describe("ai-roi-dashboard element", () => {
  beforeEach(() => {
    registerAiRoiDashboard();
  });

  it("renders hours saved and dollars saved in the hero", () => {
    const element = document.createElement(AI_ROI_DASHBOARD_TAG) as AiRoiDashboardElement;
    document.body.append(element);
    element.snapshot = goldenSnapshot;
    element.dashboardOptions = { accountName: "Demo account", periodState: "open" };

    const text = element.shadowRoot?.textContent ?? "";
    expect(text).toContain("Hours saved");
    expect(text).toContain("Estimated dollars saved");
    expect(text).toContain("$275.00");
    expect(text).toContain("Live");
    element.remove();
  });

  it("updates when snapshot property changes", () => {
    const element = document.createElement(AI_ROI_DASHBOARD_TAG) as AiRoiDashboardElement;
    document.body.append(element);
    element.snapshot = goldenSnapshot;
    const first = element.shadowRoot?.textContent ?? "";
    expect(first).toContain("3");

    const updated = structuredClone(goldenSnapshot);
    updated.totals.completedOutcomes = 5;
    element.snapshot = updated;
    expect(element.shadowRoot?.textContent).toContain("5");
    element.remove();
  });

  it("uses manual hours replaced when runtime is not measured", async () => {
    const { estimateScorecard } = await import("../src/index.js");
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
    const element = document.createElement(AI_ROI_DASHBOARD_TAG) as AiRoiDashboardElement;
    document.body.append(element);
    element.snapshot = snapshot;
    const text = element.shadowRoot?.textContent ?? "";
    expect(text).toContain("Manual hours replaced");
    expect(text).not.toContain("Hours saved");
    element.remove();
  });
});
