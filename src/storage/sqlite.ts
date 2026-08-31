import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../canonical.js";
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

export const SQLITE_MIGRATION = `
CREATE TABLE IF NOT EXISTS roi_account_cursors (
  account_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
CREATE TABLE IF NOT EXISTS roi_evidence_events (
  account_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (account_id, sequence),
  UNIQUE (account_id, event_id)
);
CREATE INDEX IF NOT EXISTS roi_evidence_event_ids
  ON roi_evidence_events (account_id, event_id);
CREATE TABLE IF NOT EXISTS roi_value_policies (
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope TEXT NOT NULL,
  scope_account TEXT NOT NULL DEFAULT '',
  policy_json TEXT NOT NULL,
  PRIMARY KEY (policy_key, version, scope, scope_account)
);
CREATE TABLE IF NOT EXISTS roi_scorecard_snapshots (
  account_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (account_id, source_fingerprint)
);`;

type JsonRow = { event_json: string };
type PolicyRow = { policy_json: string };
type SnapshotRow = { snapshot_json: string };

export class SqliteScorecardRepository implements ScorecardRepository {
  readonly #database: DatabaseSync;
  readonly #ownsDatabase: boolean;

  constructor(database: string | DatabaseSync = ":memory:") {
    this.#database = typeof database === "string" ? new DatabaseSync(database) : database;
    this.#ownsDatabase = typeof database === "string";
  }

  async migrate(): Promise<void> {
    this.#database.exec(SQLITE_MIGRATION);
  }

  async close(): Promise<void> {
    if (this.#ownsDatabase) this.#database.close();
  }

  async append(eventsInput: EvidenceEvent[]): Promise<StoredEvidenceEvent[]> {
    if (eventsInput.length === 0) return [];
    const events = eventsInput.map((event) => EvidenceEventSchema.parse(event));
    const accountId = events[0]?.accountId;
    if (!accountId || events.some((event) => event.accountId !== accountId)) {
      throw new Error("One append operation must contain events for exactly one account");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          "INSERT INTO roi_account_cursors (account_id, sequence) VALUES (?, 0) ON CONFLICT(account_id) DO NOTHING",
        )
        .run(accountId);
      const cursor = this.#database
        .prepare("SELECT sequence FROM roi_account_cursors WHERE account_id = ?")
        .get(accountId) as { sequence: number };
      let sequence = BigInt(cursor.sequence);
      const insert = this.#database.prepare(
        "INSERT INTO roi_evidence_events (account_id, sequence, event_id, event_json) VALUES (?, ?, ?, ?)",
      );
      const stored: StoredEvidenceEvent[] = [];
      for (const event of events) {
        sequence += 1n;
        const sequenced = EvidenceEventSchema.parse({ ...event, sequence: sequence.toString() });
        insert.run(accountId, Number(sequence), event.eventId, canonicalJson(sequenced));
        stored.push(sequenced as StoredEvidenceEvent);
      }
      this.#database
        .prepare("UPDATE roi_account_cursors SET sequence = ? WHERE account_id = ?")
        .run(Number(sequence), accountId);
      this.#database.exec("COMMIT");
      return stored;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async getEvents(accountId: string, query: EvidenceQuery = {}): Promise<StoredEvidenceEvent[]> {
    const conditions = ["account_id = ?"];
    const parameters: Array<string | number> = [accountId];
    if (query.afterSequence !== undefined) {
      conditions.push("sequence > ?");
      parameters.push(Number(BigInt(query.afterSequence)));
    }
    if (query.throughSequence !== undefined) {
      conditions.push("sequence <= ?");
      parameters.push(Number(BigInt(query.throughSequence)));
    }
    const rows = this.#database
      .prepare(
        `SELECT event_json FROM roi_evidence_events WHERE ${conditions.join(
          " AND ",
        )} ORDER BY sequence ASC`,
      )
      .all(...parameters) as unknown as JsonRow[];
    return rows.map(
      (row) => EvidenceEventSchema.parse(JSON.parse(row.event_json)) as StoredEvidenceEvent,
    );
  }

  async getWatermark(accountId: string): Promise<string> {
    const row = this.#database
      .prepare("SELECT sequence FROM roi_account_cursors WHERE account_id = ?")
      .get(accountId) as { sequence: number } | undefined;
    return String(row?.sequence ?? 0);
  }

  async putPolicy(policyInput: ValuePolicy): Promise<void> {
    const policy = ValuePolicySchema.parse(policyInput);
    const scopeAccount = policy.scope === "account" ? (policy.accountId ?? "") : "";
    const json = canonicalJson(policy);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO roi_value_policies (policy_key, version, scope, scope_account, policy_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(policy.policyKey, policy.version, policy.scope, scopeAccount, json);
    const stored = this.#database
      .prepare(
        "SELECT policy_json FROM roi_value_policies WHERE policy_key = ? AND version = ? AND scope = ? AND scope_account = ?",
      )
      .get(policy.policyKey, policy.version, policy.scope, scopeAccount) as PolicyRow;
    if (stored.policy_json !== json) {
      throw new Error("Approved policy versions are immutable");
    }
  }

  async getPolicies(accountId: string): Promise<ValuePolicy[]> {
    const rows = this.#database
      .prepare(
        "SELECT policy_json FROM roi_value_policies WHERE scope = 'default' OR (scope = 'account' AND scope_account = ?) ORDER BY policy_key, version",
      )
      .all(accountId) as unknown as PolicyRow[];
    return rows.map((row) => ValuePolicySchema.parse(JSON.parse(row.policy_json)));
  }

  async putSnapshot(snapshotInput: ScorecardSnapshot): Promise<ScorecardSnapshot> {
    const snapshot = ScorecardSnapshotSchema.parse(snapshotInput);
    const json = canonicalJson(snapshot);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO roi_scorecard_snapshots (account_id, source_fingerprint, snapshot_hash, snapshot_json) VALUES (?, ?, ?, ?)",
      )
      .run(snapshot.accountId, snapshot.sourceFingerprint, snapshot.snapshotHash, json);
    const stored = this.#database
      .prepare(
        "SELECT snapshot_json FROM roi_scorecard_snapshots WHERE account_id = ? AND source_fingerprint = ?",
      )
      .get(snapshot.accountId, snapshot.sourceFingerprint) as SnapshotRow;
    const existing = ScorecardSnapshotSchema.parse(JSON.parse(stored.snapshot_json));
    if (existing.snapshotHash !== snapshot.snapshotHash) {
      throw new Error("A source fingerprint cannot identify two different snapshots");
    }
    return existing;
  }

  async getSnapshotByFingerprint(
    accountId: string,
    sourceFingerprint: string,
  ): Promise<ScorecardSnapshot | undefined> {
    const row = this.#database
      .prepare(
        "SELECT snapshot_json FROM roi_scorecard_snapshots WHERE account_id = ? AND source_fingerprint = ?",
      )
      .get(accountId, sourceFingerprint) as SnapshotRow | undefined;
    return row ? ScorecardSnapshotSchema.parse(JSON.parse(row.snapshot_json)) : undefined;
  }
}
