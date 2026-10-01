import { z } from "zod";
import { IsoDateTimeSchema } from "../schemas.js";
import { sanitizeAttributes } from "./safety.js";
import type { JsonTelemetryRecord, NormalizedTelemetrySpan } from "./types.js";

function normalizeStatus(status: JsonTelemetryRecord["status"]): NormalizedTelemetrySpan["status"] {
  if (status === "ok" || status === "error" || status === "unset") return status;
  return "unset";
}

function computeDurationMs(record: JsonTelemetryRecord): number | undefined {
  if (record.endedAt === undefined) return undefined;
  const started = Date.parse(record.startedAt);
  const ended = Date.parse(record.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
}

export function parseJsonRecords(
  records: JsonTelemetryRecord[],
  source = "json",
): NormalizedTelemetrySpan[] {
  records = z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), traceId: z.string().optional(),
    startedAt: IsoDateTimeSchema, endedAt: IsoDateTimeSchema.optional(),
    status: z.enum(["ok", "error", "unset"]).optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })).parse(records) as JsonTelemetryRecord[];
  return records.map((record) => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.name !== "string" || !record.name) throw new TypeError("Records require an id and name");
    IsoDateTimeSchema.parse(record.startedAt);
    if (record.endedAt !== undefined) {
      IsoDateTimeSchema.parse(record.endedAt);
      if (Date.parse(record.endedAt) < Date.parse(record.startedAt)) throw new RangeError("Completion precedes start");
    }
    const durationMs = computeDurationMs(record);
    const span: NormalizedTelemetrySpan = {
      source,
      sourceId: record.id,
      traceId: record.traceId ?? record.id,
      name: record.name,
      startedAt: record.startedAt,
      status: normalizeStatus(record.status),
      attributes: sanitizeAttributes(record.attributes ?? {}),
    };
    if (record.endedAt !== undefined) span.endedAt = record.endedAt;
    if (durationMs !== undefined) span.durationMs = durationMs;
    return span;
  });
}
