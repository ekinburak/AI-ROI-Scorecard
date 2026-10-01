import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generateScorecard } from "../../dist/index.js";
import {
  ingestOtlpJson,
} from "../../dist/adapters.js";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/golden-otlp.input.json", import.meta.url),
);

const ledger = new Map();

const repository = {
  async getEvents(accountId) {
    return ledger.get(accountId) ?? [];
  },
  async append(events) {
    const accountId = events[0].accountId;
    const existing = ledger.get(accountId) ?? [];
    let sequence = existing.length;
    const stored = events.map((event) => {
      sequence += 1;
      return { ...event, sequence: String(sequence) };
    });
    ledger.set(accountId, [...existing, ...stored]);
    return stored;
  },
};

const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
const first = await ingestOtlpJson(repository, payload, { accountId: "fallback-account" });
const second = await ingestOtlpJson(repository, payload, { accountId: "fallback-account" });

const snapshot = generateScorecard({
  accountId: "demo-account",
  period: {
    start: "2026-08-21T00:00:00.000Z",
    end: "2026-08-28T00:00:00.000Z",
  },
  generatedAt: "2026-08-28T08:00:00.000Z",
  events: await repository.getEvents("demo-account"),
  policies: [
    {
      policyKey: "ticket-triage",
      version: 1,
      scope: "default",
      label: { default: "Support ticket triage", translations: {} },
      manualMinutesPerUnit: 45,
      evidenceLevel: "approved_baseline",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    },
  ],
  valuation: {
    currency: "USD",
    hourlyValueMinor: "10000",
    serviceCostMinor: "25000",
  },
});

console.log(
  JSON.stringify(
    {
      appended: first.appended.length,
      skippedOnReplay: second.skipped,
      status: snapshot.status,
      completedOutcomes: snapshot.totals.completedOutcomes,
      estimatedValueMinor: snapshot.totals.estimatedValueMinor,
      aiDurationMs: snapshot.totals.aiDurationMs,
    },
    null,
    2,
  ),
);
