import { describe, expect, it } from "vitest";

import { estimateScorecard, type EvidenceEvent, type ValuePolicy } from "../src/index.js";
import { SqliteScorecardRepository } from "../src/storage/sqlite.js";

const event = (id: string): EvidenceEvent => ({
  type: "attempt_started",
  eventId: id,
  accountId: "demo",
  runId: `run-${id}`,
  attemptId: `attempt-${id}`,
  workflowKey: "ticket-triage",
  policyKey: "ticket-triage",
  occurredAt: "2026-08-01T00:00:00.000Z",
});

const policy: ValuePolicy = {
  policyKey: "ticket-triage",
  version: 1,
  scope: "default",
  label: { default: "Ticket triage", translations: {} },
  manualMinutesPerUnit: 30,
  evidenceLevel: "approved_baseline",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

describe("SQLite repository", () => {
  it("assigns stable account watermarks and persists immutable records", async () => {
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    const [first, second] = await Promise.all([
      repository.append([event("one")]),
      repository.append([event("two")]),
    ]);
    expect([first[0]?.sequence, second[0]?.sequence].sort()).toEqual(["1", "2"]);
    expect(await repository.getWatermark("demo")).toBe("2");
    expect((await repository.getEvents("demo", { throughSequence: "1" })).length).toBe(1);

    await repository.putPolicy(policy);
    await repository.putPolicy(policy);
    expect(await repository.getPolicies("demo")).toEqual([policy]);
    await expect(
      repository.putPolicy({ ...policy, manualMinutesPerUnit: 99 }),
    ).rejects.toThrow("immutable");

    const snapshot = estimateScorecard({
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      generatedAt: "2026-08-08T08:00:00.000Z",
      workflows: [
        { workflowKey: "ticket-triage", label: "Ticket triage", manualMinutes: 30, units: 1, aiDurationMs: 50 },
      ],
      valuation: { currency: "USD", hourlyValueMinor: "6000" },
    });
    expect(await repository.putSnapshot(snapshot)).toEqual(snapshot);
    expect(await repository.putSnapshot(snapshot)).toEqual(snapshot);
    await repository.close();
  });

  it("rolls back an append when a durable event id is duplicated", async () => {
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    await repository.append([event("same")]);
    await expect(repository.append([event("same")])).rejects.toThrow();
    expect(await repository.getWatermark("demo")).toBe("1");
    await repository.close();
  });
});
