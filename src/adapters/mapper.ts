import { EvidenceEventSchema, IsoDateTimeSchema, MAX_INPUT_INTEGER, type EvidenceEvent } from "../schemas.js";
import {
  readSemanticNumber,
  readSemanticString,
  ROI_SEMANTIC_ATTRIBUTES,
} from "./safety.js";
import type {
  DurationMode,
  NormalizedTelemetrySpan,
  TelemetryMapping,
  TelemetryResolver,
} from "./types.js";

function resolve<T>(
  span: NormalizedTelemetrySpan,
  semanticKey: string,
  resolver: TelemetryResolver<T> | undefined,
): T | undefined {
  const semantic = readSemanticString(span.attributes, semanticKey);
  if (semantic !== undefined) return semantic as T;
  return resolver?.(span);
}

function eventId(spanId: string, suffix: string): string {
  return `${spanId}:${suffix}`;
}

function mapStatus(
  status: NormalizedTelemetrySpan["status"],
): "succeeded" | "failed" | "cancelled" | "abandoned" {
  if (status === "ok") return "succeeded";
  if (status === "error") return "failed";
  return "abandoned";
}

function resolveDurationMs(
  span: NormalizedTelemetrySpan,
  durationMode: DurationMode,
): number | undefined {
  if (durationMode === "omit") return undefined;
  if (span.durationMs !== undefined) {
    if (!Number.isSafeInteger(span.durationMs) || span.durationMs < 0 || span.durationMs > MAX_INPUT_INTEGER) throw new RangeError("Invalid span duration");
    return span.durationMs;
  }
  if (span.endedAt !== undefined) {
    const started = Date.parse(span.startedAt);
    const ended = Date.parse(span.endedAt);
    if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
      return ended - started;
    }
  }
  return undefined;
}

export class TelemetryEvidenceMapper {
  readonly #mapping: TelemetryMapping;

  constructor(mapping: TelemetryMapping) {
    this.#mapping = mapping;
  }

  mapSpan(span: NormalizedTelemetrySpan): EvidenceEvent[] {
    const workflowKey = resolve(span, ROI_SEMANTIC_ATTRIBUTES.workflowKey, this.#mapping.workflowKey);
    const policyKey = resolve(span, ROI_SEMANTIC_ATTRIBUTES.policyKey, this.#mapping.policyKey);
    const accountId =
      readSemanticString(span.attributes, ROI_SEMANTIC_ATTRIBUTES.accountId) ??
      this.#mapping.accountId;

    if (!workflowKey || !policyKey || !accountId) return [];

    IsoDateTimeSchema.parse(span.startedAt);
    if (span.endedAt === undefined) throw new TypeError("Mapped work requires a completion timestamp");
    IsoDateTimeSchema.parse(span.endedAt);
    if (Date.parse(span.endedAt) < Date.parse(span.startedAt)) throw new RangeError("Completion precedes start");
    const durationMode = this.#mapping.durationMode ?? "span";
    if (durationMode !== "span" && durationMode !== "omit") throw new TypeError("Invalid duration mode");
    const durationMs = resolveDurationMs(span, durationMode);
    if (durationMode === "span" && durationMs === undefined) return [];

    const runId = span.traceId;
    const attemptId = span.sourceId;
    const base = {
      accountId,
      runId,
      attemptId,
      workflowKey,
      policyKey,
    };

    const events: EvidenceEvent[] = [
      {
        ...base,
        eventId: eventId(span.sourceId, "started"),
        type: "attempt_started",
        occurredAt: span.startedAt,
      },
    ];

    const finishedAt = span.endedAt ?? span.startedAt;
    const attemptStatus = mapStatus(span.status);
    const finished: EvidenceEvent = {
      ...base,
      eventId: eventId(span.sourceId, "finished"),
      type: "attempt_finished",
      occurredAt: finishedAt,
      status: attemptStatus,
      ...(durationMs === undefined ? {} : { activeDurationMs: durationMs }),
    };
    events.push(finished);

    if (attemptStatus !== "succeeded") {
      const category =
        resolve(span, "exception.category", this.#mapping.exceptionCategory) ?? "TelemetryError";
      events.push({
        ...base,
        eventId: eventId(span.sourceId, "exception"),
        type: "exception_recorded",
        occurredAt: finishedAt,
        exceptionId: eventId(span.sourceId, "exception"),
        category,
      });
      return events.map((event) => EvidenceEventSchema.parse(event));
    }

    const shouldRecordOutcome =
      this.#mapping.recordOutcome?.(span) ??
      (attemptStatus === "succeeded" &&
        resolve(span, ROI_SEMANTIC_ATTRIBUTES.outcomeId, this.#mapping.outcomeId) !== undefined);
    if (!shouldRecordOutcome) return events.map((event) => EvidenceEventSchema.parse(event));

    const outcomeId = resolve(span, ROI_SEMANTIC_ATTRIBUTES.outcomeId, this.#mapping.outcomeId);
    if (!outcomeId) return events.map((event) => EvidenceEventSchema.parse(event));

    const units =
      readSemanticNumber(span.attributes, ROI_SEMANTIC_ATTRIBUTES.units) ??
      this.#mapping.units?.(span) ??
      1;

    events.push({
      ...base,
      eventId: eventId(span.sourceId, "outcome"),
      type: "outcome_completed",
      occurredAt: finishedAt,
      outcomeId,
      units,
    });
    return events.map((event) => EvidenceEventSchema.parse(event));
  }

  mapSpans(spans: NormalizedTelemetrySpan[]): EvidenceEvent[] {
    return spans.flatMap((span) => this.mapSpan(span));
  }
}
