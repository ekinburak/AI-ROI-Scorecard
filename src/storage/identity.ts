import { canonicalJson } from "../canonical.js";
import type { EvidenceEvent } from "../schemas.js";

export function evidencePayload(event: EvidenceEvent): string {
  const payload = { ...event };
  delete payload.sequence;
  return canonicalJson(payload);
}
