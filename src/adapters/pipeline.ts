import type { EvidenceRepository } from "../storage/index.js";
import { ingestTelemetryEvidence, type TelemetryIngestResult } from "./ingest.js";
import { parseJsonRecords } from "./json.js";
import { TelemetryEvidenceMapper } from "./mapper.js";
import { parseOtlpJson, type OtlpJsonPayload } from "./otel.js";
import type { JsonTelemetryRecord, TelemetryMapping } from "./types.js";

export interface TelemetryPipelineResult extends TelemetryIngestResult {
  mapped: number;
  spans: number;
}

export async function ingestOtlpJson(
  repository: EvidenceRepository,
  payload: OtlpJsonPayload,
  mapping: TelemetryMapping,
): Promise<TelemetryPipelineResult> {
  const spans = parseOtlpJson(payload);
  const events = new TelemetryEvidenceMapper(mapping).mapSpans(spans);
  const result = await ingestTelemetryEvidence(repository, events);
  return { ...result, mapped: events.length, spans: spans.length };
}

export async function ingestJsonRecords(
  repository: EvidenceRepository,
  records: JsonTelemetryRecord[],
  mapping: TelemetryMapping,
): Promise<TelemetryPipelineResult> {
  const spans = parseJsonRecords(records);
  const events = new TelemetryEvidenceMapper(mapping).mapSpans(spans);
  const result = await ingestTelemetryEvidence(repository, events);
  return { ...result, mapped: events.length, spans: spans.length };
}
