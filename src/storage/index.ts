import type { EvidenceEvent, ScorecardSnapshot, ValuePolicy } from "../schemas.js";

export type StoredEvidenceEvent = EvidenceEvent & { sequence: string };

export interface EvidenceQuery {
  afterSequence?: string;
  throughSequence?: string;
}

export interface EvidenceRepository {
  append(events: EvidenceEvent[]): Promise<StoredEvidenceEvent[]>;
  appendIfAbsent?(events: EvidenceEvent[]): Promise<StoredEvidenceEvent[]>;
  getEvents(accountId: string, query?: EvidenceQuery): Promise<StoredEvidenceEvent[]>;
  getWatermark(accountId: string): Promise<string>;
}

export interface PolicyRepository {
  putPolicy(policy: ValuePolicy): Promise<void>;
  getPolicies(accountId: string): Promise<ValuePolicy[]>;
}

export interface SnapshotRepository {
  putSnapshot(snapshot: ScorecardSnapshot): Promise<ScorecardSnapshot>;
  getSnapshotByFingerprint(
    accountId: string,
    sourceFingerprint: string,
  ): Promise<ScorecardSnapshot | undefined>;
}

export interface ScorecardRepository
  extends EvidenceRepository,
    PolicyRepository,
    SnapshotRepository {
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const GENERIC_STORAGE_SCHEMA_VERSION = 1 as const;
