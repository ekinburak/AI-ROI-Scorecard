import type { EvidenceEvent } from "./schemas.js";

export interface AsyncEvidenceSink {
  append(events: EvidenceEvent[]): Promise<void>;
}

export interface SyncEvidenceSink {
  append(events: EvidenceEvent[]): void;
}

export interface InstrumentationOptions<Sink> {
  accountId: string;
  workflowKey: string;
  policyKey: string;
  sink: Sink;
  now?: () => Date;
  monotonicNow?: () => number;
  idFactory?: () => string;
  classifyError?: (error: unknown) => { category: string; safeMessage?: string };
}

export interface InstrumentRunOptions {
  runId?: string;
  attemptId?: string;
  outcomeId?: string;
  units?: number;
  recordOutcome?: boolean;
}

export interface InstrumentedResult<T> {
  result: T;
  runId: string;
  attemptId: string;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultClassification(error: unknown): { category: string; safeMessage?: string } {
  if (error instanceof Error) return { category: error.name || "Error" };
  return { category: "UnknownError" };
}

function eventBase<Sink>(
  options: InstrumentationOptions<Sink>,
  runId: string,
  attemptId: string,
  eventId: string,
  occurredAt: string,
) {
  return {
    eventId,
    accountId: options.accountId,
    runId,
    attemptId,
    workflowKey: options.workflowKey,
    policyKey: options.policyKey,
    occurredAt,
  };
}

export async function instrumentAsync<T>(
  options: InstrumentationOptions<AsyncEvidenceSink>,
  work: () => Promise<T>,
  runOptions: InstrumentRunOptions = {},
): Promise<InstrumentedResult<T>> {
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const idFactory = options.idFactory ?? defaultId;
  const runId = runOptions.runId ?? idFactory();
  const attemptId = runOptions.attemptId ?? idFactory();
  await options.sink.append([
    {
      ...eventBase(options, runId, attemptId, idFactory(), now().toISOString()),
      type: "attempt_started",
    },
  ]);
  const started = monotonicNow();
  try {
    const result = await work();
    const duration = Math.max(0, Math.round(monotonicNow() - started));
    const finishedAt = now().toISOString();
    const events: EvidenceEvent[] = [
      {
        ...eventBase(options, runId, attemptId, idFactory(), finishedAt),
        type: "attempt_finished",
        status: "succeeded",
        activeDurationMs: duration,
      },
    ];
    if (runOptions.recordOutcome !== false) {
      events.push({
        ...eventBase(options, runId, attemptId, idFactory(), finishedAt),
        type: "outcome_completed",
        outcomeId: runOptions.outcomeId ?? idFactory(),
        units: runOptions.units ?? 1,
      });
    }
    await options.sink.append(events);
    return { result, runId, attemptId };
  } catch (error) {
    const duration = Math.max(0, Math.round(monotonicNow() - started));
    const failedAt = now().toISOString();
    const classification = (options.classifyError ?? defaultClassification)(error);
    await options.sink.append([
      {
        ...eventBase(options, runId, attemptId, idFactory(), failedAt),
        type: "attempt_finished",
        status: "failed",
        activeDurationMs: duration,
      },
      {
        ...eventBase(options, runId, attemptId, idFactory(), failedAt),
        type: "exception_recorded",
        exceptionId: idFactory(),
        category: classification.category,
        ...(classification.safeMessage === undefined
          ? {}
          : { safeMessage: classification.safeMessage }),
      },
    ]);
    throw error;
  }
}

export function instrumentSync<T>(
  options: InstrumentationOptions<SyncEvidenceSink>,
  work: () => T,
  runOptions: InstrumentRunOptions = {},
): InstrumentedResult<T> {
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const idFactory = options.idFactory ?? defaultId;
  const runId = runOptions.runId ?? idFactory();
  const attemptId = runOptions.attemptId ?? idFactory();
  options.sink.append([
    {
      ...eventBase(options, runId, attemptId, idFactory(), now().toISOString()),
      type: "attempt_started",
    },
  ]);
  const started = monotonicNow();
  try {
    const result = work();
    const duration = Math.max(0, Math.round(monotonicNow() - started));
    const finishedAt = now().toISOString();
    const events: EvidenceEvent[] = [
      {
        ...eventBase(options, runId, attemptId, idFactory(), finishedAt),
        type: "attempt_finished",
        status: "succeeded",
        activeDurationMs: duration,
      },
    ];
    if (runOptions.recordOutcome !== false) {
      events.push({
        ...eventBase(options, runId, attemptId, idFactory(), finishedAt),
        type: "outcome_completed",
        outcomeId: runOptions.outcomeId ?? idFactory(),
        units: runOptions.units ?? 1,
      });
    }
    options.sink.append(events);
    return { result, runId, attemptId };
  } catch (error) {
    const duration = Math.max(0, Math.round(monotonicNow() - started));
    const failedAt = now().toISOString();
    const classification = (options.classifyError ?? defaultClassification)(error);
    options.sink.append([
      {
        ...eventBase(options, runId, attemptId, idFactory(), failedAt),
        type: "attempt_finished",
        status: "failed",
        activeDurationMs: duration,
      },
      {
        ...eventBase(options, runId, attemptId, idFactory(), failedAt),
        type: "exception_recorded",
        exceptionId: idFactory(),
        category: classification.category,
        ...(classification.safeMessage === undefined
          ? {}
          : { safeMessage: classification.safeMessage }),
      },
    ]);
    throw error;
  }
}
