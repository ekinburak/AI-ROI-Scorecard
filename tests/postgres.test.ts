import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import type { EvidenceEvent } from "../src/index.js";
import {
  PostgresScorecardRepository,
  type PostgresPoolLike,
} from "../src/storage/postgres.js";

const connectionString = process.env.TEST_POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL repository", () => {
  it("serializes concurrent account writers", async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresScorecardRepository(pool as unknown as PostgresPoolLike);
    await repository.migrate();
    const accountId = `test-${Date.now()}`;
    const makeEvent = (id: string): EvidenceEvent => ({
      type: "attempt_started",
      eventId: id,
      accountId,
      runId: `run-${id}`,
      attemptId: `attempt-${id}`,
      workflowKey: "ticket-triage",
      policyKey: "ticket-triage",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => repository.append([makeEvent(`event-${index}`)])),
    );
    expect(results.flat().map((event) => event.sequence).sort((a, b) => Number(a) - Number(b))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(await repository.getWatermark(accountId)).toBe("8");
    await pool.end();
  });
});
