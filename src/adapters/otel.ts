import { z } from "zod";
import { sanitizeAttributes } from "./safety.js";
import type { NormalizedTelemetrySpan, TelemetrySpanStatus } from "./types.js";

interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: number; message?: string };
  attributes?: OtlpAttribute[];
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpJsonPayload {
  resourceSpans?: OtlpResourceSpans[];
}

function decodeAttributeValue(value: OtlpAttributeValue): string | number | boolean | undefined {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  return undefined;
}

function attributesFromOtlp(attributes: OtlpAttribute[] | undefined): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const attribute of attributes ?? []) {
    const decoded = decodeAttributeValue(attribute.value);
    if (decoded !== undefined) result[attribute.key] = decoded;
  }
  return sanitizeAttributes(result);
}

function nanoToIso(nano: string | undefined): string | undefined {
  if (nano === undefined) return undefined;
  const milliseconds = Number(BigInt(nano) / 1_000_000n);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString();
}

function mapOtlpStatus(code: number | undefined): TelemetrySpanStatus {
  if (code === 1) return "ok";
  if (code === 2) return "error";
  return "unset";
}

export function parseOtlpJson(payload: OtlpJsonPayload, source = "otlp"): NormalizedTelemetrySpan[] {
  const attribute = z.object({ key: z.string(), value: z.object({stringValue:z.string().optional(), intValue:z.union([z.string().regex(/^-?\d+$/).max(32),z.number().int()]).optional(),doubleValue:z.number().optional(),boolValue:z.boolean().optional()}) });
  const span = z.object({traceId:z.string().optional(),spanId:z.string().optional(),name:z.string().optional(),startTimeUnixNano:z.string().regex(/^\d+$/).max(32).optional(),endTimeUnixNano:z.string().regex(/^\d+$/).max(32).optional(),status:z.object({code:z.number().int().min(0).max(2).optional()}).optional(),attributes:z.array(attribute).optional()});
  payload = z.object({resourceSpans:z.array(z.object({scopeSpans:z.array(z.object({spans:z.array(span).optional()})).optional()})).optional()}).parse(payload) as OtlpJsonPayload;
  const spans: NormalizedTelemetrySpan[] = [];
  for (const resourceSpan of payload.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const otlpSpan of scopeSpan.spans ?? []) {
        const sourceId = otlpSpan.spanId;
        if (!sourceId || !otlpSpan.name) continue;
        const startedAt = nanoToIso(otlpSpan.startTimeUnixNano);
        if (!startedAt) continue;
        const endedAt = nanoToIso(otlpSpan.endTimeUnixNano);
        let durationMs: number | undefined;
        if (otlpSpan.startTimeUnixNano !== undefined && otlpSpan.endTimeUnixNano !== undefined) {
          const start = BigInt(otlpSpan.startTimeUnixNano);
          const end = BigInt(otlpSpan.endTimeUnixNano);
          if (end < start) throw new RangeError("Completion precedes start");
          if (end >= start) {
            durationMs = Number((end - start) / 1_000_000n);
          }
        }
        const normalized: NormalizedTelemetrySpan = {
          source,
          sourceId,
          traceId: otlpSpan.traceId ?? sourceId,
          name: otlpSpan.name,
          startedAt,
          status: mapOtlpStatus(otlpSpan.status?.code),
          attributes: attributesFromOtlp(otlpSpan.attributes),
        };
        if (endedAt !== undefined) normalized.endedAt = endedAt;
        if (durationMs !== undefined) normalized.durationMs = durationMs;
        spans.push(normalized);
      }
    }
  }
  return spans;
}
