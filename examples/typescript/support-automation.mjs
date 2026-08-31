import {
  generateScorecard,
  instrumentAsync,
  renderReport,
} from "../../dist/index.js";

const events = [];
const sink = { append: async (batch) => void events.push(...batch) };
const period = {
  start: "2026-08-21T00:00:00.000Z",
  end: "2026-08-28T00:00:00.000Z",
};

await instrumentAsync(
  {
    accountId: "support-demo",
    workflowKey: "ticket-triage",
    policyKey: "ticket-triage",
    sink,
    now: () => new Date("2026-08-22T10:00:00.000Z"),
  },
  async () => ({ category: "billing" }),
  { runId: "run-1", attemptId: "attempt-1", outcomeId: "ticket-1042" },
);

const snapshot = generateScorecard({
  accountId: "support-demo",
  period,
  generatedAt: "2026-08-28T08:00:00.000Z",
  events,
  policies: [
    {
      policyKey: "ticket-triage",
      version: 1,
      scope: "default",
      label: { default: "Support ticket triage" },
      manualMinutesPerUnit: 30,
      evidenceLevel: "approved_baseline",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    },
  ],
  valuation: { currency: "USD", hourlyValueMinor: "9000", serviceCostMinor: "1000" },
});

console.log(renderReport(snapshot, { accountName: "Support demo" }).text);
