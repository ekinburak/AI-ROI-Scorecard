import { describe, expect, it } from "vitest";

import {
  instrumentAsync,
  instrumentSync,
  type EvidenceEvent,
} from "../src/index.js";

function deterministicIds() {
  let value = 0;
  return () => `id-${++value}`;
}

describe("workflow instrumentation", () => {
  it("records measured async success without queue time", async () => {
    const events: EvidenceEvent[] = [];
    const wall = [new Date("2026-08-01T00:00:00.000Z"), new Date("2026-08-01T00:00:01.250Z")];
    const monotonic = [100, 1350];
    const output = await instrumentAsync(
      {
        accountId: "demo",
        workflowKey: "ticket-triage",
        policyKey: "ticket-triage",
        sink: { append: async (batch) => void events.push(...batch) },
        now: () => wall.shift()!,
        monotonicNow: () => monotonic.shift()!,
        idFactory: deterministicIds(),
      },
      async () => "done",
      { outcomeId: "outcome-1", units: 2 },
    );
    expect(output.result).toBe("done");
    expect(events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_finished",
      "outcome_completed",
    ]);
    expect(events[1]).toMatchObject({ activeDurationMs: 1250, status: "succeeded" });
  });

  it("records a safe exception and rethrows synchronous failures", () => {
    const events: EvidenceEvent[] = [];
    const monotonic = [5, 17];
    expect(() =>
      instrumentSync(
        {
          accountId: "demo",
          workflowKey: "reply-draft",
          policyKey: "reply-draft",
          sink: { append: (batch) => void events.push(...batch) },
          now: () => new Date("2026-08-01T00:00:00.000Z"),
          monotonicNow: () => monotonic.shift()!,
          idFactory: deterministicIds(),
        },
        () => {
          throw new Error("provider token should not be copied");
        },
      ),
    ).toThrow("provider token");
    expect(events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_finished",
      "exception_recorded",
    ]);
    expect(events[2]).toMatchObject({ category: "Error" });
    expect(events[2]).not.toHaveProperty("safeMessage");
  });
});
