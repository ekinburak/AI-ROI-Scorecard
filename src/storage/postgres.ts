import { canonicalJson } from "../canonical.js";
import { evidencePayload } from "./identity.js";
import {
  EvidenceEventSchema,
  ScorecardSnapshotSchema,
  ValuePolicySchema,
  type EvidenceEvent,
  type ScorecardSnapshot,
  type ValuePolicy,
} from "../schemas.js";
import type {
  EvidenceQuery,
  ScorecardRepository,
  StoredEvidenceEvent,
} from "./index.js";

interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface PostgresPoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
  end?(): Promise<void>;
}

export const POSTGRES_MIGRATION = `
CREATE TABLE IF NOT EXISTS roi_account_cursors (
  account_id TEXT PRIMARY KEY,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
CREATE TABLE IF NOT EXISTS roi_evidence_events (
  account_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  event_json JSONB NOT NULL,
  PRIMARY KEY (account_id, sequence),
  UNIQUE (account_id, event_id)
);
CREATE TABLE IF NOT EXISTS roi_value_policies (
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope TEXT NOT NULL,
  scope_account TEXT NOT NULL DEFAULT '',
  policy_json JSONB NOT NULL,
  PRIMARY KEY (policy_key, version, scope, scope_account)
);
CREATE TABLE IF NOT EXISTS roi_scorecard_snapshots (
  account_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  PRIMARY KEY (account_id, source_fingerprint)
);`;

export class PostgresScorecardRepository implements ScorecardRepository {
  constructor(
    private readonly pool: PostgresPoolLike,
    private readonly ownsPool = false,
  ) {}

  async migrate(): Promise<void> {
    await this.pool.query(POSTGRES_MIGRATION);
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end?.();
  }

  async append(eventsInput: EvidenceEvent[]): Promise<StoredEvidenceEvent[]> {
    return this.#append(eventsInput, false);
  }

  async appendIfAbsent(eventsInput: EvidenceEvent[]): Promise<StoredEvidenceEvent[]> {
    return this.#append(eventsInput, true);
  }

  async #append(eventsInput: EvidenceEvent[], skipIdentical: boolean): Promise<StoredEvidenceEvent[]> {
    if (eventsInput.length === 0) return [];
    const events = eventsInput.map((event) => EvidenceEventSchema.parse(event));
    const accountId = events[0]?.accountId;
    if (!accountId || events.some((event) => event.accountId !== accountId)) {
      throw new Error("One append operation must contain events for exactly one account");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO roi_account_cursors (account_id, sequence) VALUES ($1, 0) ON CONFLICT(account_id) DO NOTHING",
        [accountId],
      );
      const cursor = await client.query<{ sequence: string }>(
        "SELECT sequence::text AS sequence FROM roi_account_cursors WHERE account_id = $1 FOR UPDATE",
        [accountId],
      );
      let sequence = BigInt(cursor.rows[0]?.sequence ?? "0");
      const stored: StoredEvidenceEvent[] = [];
      for (const event of events) {
        if (skipIdentical) {
          const existing = await client.query<{ event_json: unknown }>("SELECT event_json FROM roi_evidence_events WHERE account_id = $1 AND event_id = $2", [accountId, event.eventId]);
          const row = existing.rows[0];
          if (row) {
            if (evidencePayload(EvidenceEventSchema.parse(row.event_json)) !== evidencePayload(event)) throw new Error("Conflicting evidence for an existing event ID");
            continue;
          }
        }
        sequence += 1n;
        const sequenced = EvidenceEventSchema.parse({ ...event, sequence: sequence.toString() });
        await client.query(
          "INSERT INTO roi_evidence_events (account_id, sequence, event_id, event_json) VALUES ($1, $2, $3, $4::jsonb)",
          [accountId, sequence.toString(), event.eventId, canonicalJson(sequenced)],
        );
        stored.push(sequenced as StoredEvidenceEvent);
      }
      await client.query(
        "UPDATE roi_account_cursors SET sequence = $2 WHERE account_id = $1",
        [accountId, sequence.toString()],
      );
      await client.query("COMMIT");
      return stored;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getEvents(accountId: string, query: EvidenceQuery = {}): Promise<StoredEvidenceEvent[]> {
    const conditions = ["account_id = $1"];
    const values: unknown[] = [accountId];
    if (query.afterSequence !== undefined) {
      values.push(query.afterSequence);
      conditions.push(`sequence > $${values.length}`);
    }
    if (query.throughSequence !== undefined) {
      values.push(query.throughSequence);
      conditions.push(`sequence <= $${values.length}`);
    }
    const result = await this.pool.query<{ event_json: unknown }>(
      `SELECT event_json FROM roi_evidence_events WHERE ${conditions.join(
        " AND ",
      )} ORDER BY sequence ASC`,
      values,
    );
    return result.rows.map(
      (row) => EvidenceEventSchema.parse(row.event_json) as StoredEvidenceEvent,
    );
  }

  async getWatermark(accountId: string): Promise<string> {
    const result = await this.pool.query<{ sequence: string }>(
      "SELECT sequence::text AS sequence FROM roi_account_cursors WHERE account_id = $1",
      [accountId],
    );
    return result.rows[0]?.sequence ?? "0";
  }

  async putPolicy(policyInput: ValuePolicy): Promise<void> {
    const policy = ValuePolicySchema.parse(policyInput);
    const scopeAccount = policy.scope === "account" ? (policy.accountId ?? "") : "";
    const json = canonicalJson(policy);
    await this.pool.query(
      "INSERT INTO roi_value_policies (policy_key, version, scope, scope_account, policy_json) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING",
      [policy.policyKey, policy.version, policy.scope, scopeAccount, json],
    );
    const result = await this.pool.query<{ policy_json: unknown }>(
      "SELECT policy_json FROM roi_value_policies WHERE policy_key = $1 AND version = $2 AND scope = $3 AND scope_account = $4",
      [policy.policyKey, policy.version, policy.scope, scopeAccount],
    );
    if (canonicalJson(result.rows[0]?.policy_json) !== json) {
      throw new Error("Approved policy versions are immutable");
    }
  }

  async getPolicies(accountId: string): Promise<ValuePolicy[]> {
    const result = await this.pool.query<{ policy_json: unknown }>(
      "SELECT policy_json FROM roi_value_policies WHERE scope = 'default' OR (scope = 'account' AND scope_account = $1) ORDER BY policy_key, version",
      [accountId],
    );
    return result.rows.map((row) => ValuePolicySchema.parse(row.policy_json));
  }

  async putSnapshot(snapshotInput: ScorecardSnapshot): Promise<ScorecardSnapshot> {
    const snapshot = ScorecardSnapshotSchema.parse(snapshotInput);
    const json = canonicalJson(snapshot);
    await this.pool.query(
      "INSERT INTO roi_scorecard_snapshots (account_id, source_fingerprint, snapshot_hash, snapshot_json) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING",
      [snapshot.accountId, snapshot.sourceFingerprint, snapshot.snapshotHash, json],
    );
    const existing = await this.getSnapshotByFingerprint(
      snapshot.accountId,
      snapshot.sourceFingerprint,
    );
    if (!existing || existing.snapshotHash !== snapshot.snapshotHash) {
      throw new Error("A source fingerprint cannot identify two different snapshots");
    }
    return existing;
  }

  async getSnapshotByFingerprint(
    accountId: string,
    sourceFingerprint: string,
  ): Promise<ScorecardSnapshot | undefined> {
    const result = await this.pool.query<{ snapshot_json: unknown }>(
      "SELECT snapshot_json FROM roi_scorecard_snapshots WHERE account_id = $1 AND source_fingerprint = $2",
      [accountId, sourceFingerprint],
    );
    return result.rows[0]
      ? ScorecardSnapshotSchema.parse(result.rows[0].snapshot_json)
      : undefined;
  }
}
