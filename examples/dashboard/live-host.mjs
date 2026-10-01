import { estimateScorecard } from "../../dist/index.js";
import {
  AI_ROI_DASHBOARD_TAG,
  registerAiRoiDashboard,
} from "../../dist/dashboard.js";

registerAiRoiDashboard();
await customElements.whenDefined(AI_ROI_DASHBOARD_TAG);

const element = document.querySelector("#dashboard");
if (!element) {
  throw new Error("Missing #dashboard element");
}

const period = {
  start: "2026-08-21T00:00:00.000Z",
  end: "2026-08-28T00:00:00.000Z",
};

let units = 3;

function refresh() {
  element.snapshot = estimateScorecard({
    accountId: "example-team",
    period,
    generatedAt: new Date().toISOString(),
    workflows: [
      {
        workflowKey: "support-triage",
        label: "Support ticket triage",
        manualMinutes: 30,
        units,
        aiDurationMs: units * 1200,
      },
      {
        workflowKey: "reply-draft",
        label: "Customer reply drafting",
        manualMinutes: 45,
        units: Math.max(1, Math.floor(units / 2)),
        aiDurationMs: Math.max(1, Math.floor(units / 2)) * 1800,
      },
    ],
    valuation: {
      currency: "USD",
      hourlyValueMinor: "10000",
      serviceCostMinor: "25000",
    },
  });
}

refresh();
window.setInterval(() => {
  units += 1;
  refresh();
}, 4000);
