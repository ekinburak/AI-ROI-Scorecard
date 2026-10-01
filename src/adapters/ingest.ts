import { EvidenceEventSchema, type EvidenceEvent } from "../schemas.js";
import type { EvidenceRepository, StoredEvidenceEvent } from "../storage/index.js";
import { evidencePayload } from "../storage/identity.js";

export interface TelemetryIngestResult {
  appended: StoredEvidenceEvent[];
  skipped: number;
}

export async function ingestTelemetryEvidence(repository: EvidenceRepository, input: EvidenceEvent[]): Promise<TelemetryIngestResult> {
  const events = input.map((event) => EvidenceEventSchema.parse(event));
  if (events.length === 0) return { appended: [], skipped: 0 };
  const accountId = events[0]!.accountId;
  if (events.some((event) => event.accountId !== accountId)) throw new Error("One ingest operation must contain events for exactly one account");
  if (repository.appendIfAbsent) {
    const appended = await repository.appendIfAbsent(events);
    return { appended, skipped: events.length - appended.length };
  }
  // Legacy repositories must serialize ingest calls themselves.
  const known = new Map((await repository.getEvents(accountId)).map((event) => [event.eventId, evidencePayload(event)]));
  const fresh: EvidenceEvent[] = [];
  for (const event of events) {
    const previous = known.get(event.eventId);
    const payload = evidencePayload(event);
    if (previous !== undefined && previous !== payload) throw new Error("Conflicting evidence for an existing event ID");
    if (previous === undefined) fresh.push(event);
    known.set(event.eventId, payload);
  }
  const appended = fresh.length ? await repository.append(fresh) : [];
  return { appended, skipped: events.length - appended.length };
}
