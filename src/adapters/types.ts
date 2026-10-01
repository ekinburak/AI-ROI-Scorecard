export type TelemetrySpanStatus = "ok" | "error" | "unset";

export type DurationMode = "span" | "omit";

export type TelemetryResolver<T> = (span: NormalizedTelemetrySpan) => T | undefined;

export interface NormalizedTelemetrySpan {
  source: string;
  sourceId: string;
  traceId: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: TelemetrySpanStatus;
  attributes: Record<string, string | number | boolean>;
}

export interface TelemetryMapping {
  accountId: string;
  workflowKey?: TelemetryResolver<string>;
  policyKey?: TelemetryResolver<string>;
  outcomeId?: TelemetryResolver<string>;
  recordOutcome?: (span: NormalizedTelemetrySpan) => boolean;
  units?: TelemetryResolver<number>;
  durationMode?: DurationMode;
  exceptionCategory?: TelemetryResolver<string>;
}

export interface JsonTelemetryRecord {
  id: string;
  traceId?: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status?: TelemetrySpanStatus;
  attributes?: Record<string, string | number | boolean>;
}
