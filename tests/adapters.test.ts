import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TelemetryEvidenceMapper,
  ingestOtlpJson,
  ingestTelemetryEvidence,
  parseJsonRecords,
  parseOtlpJson,
  sanitizeAttributes,
} from "../src/adapters/index.js";
import type { EvidenceEvent } from "../src/schemas.js";
import { SqliteScorecardRepository } from "../src/storage/sqlite.js";

const otlpInputPath = fileURLToPath(
  new URL("../fixtures/golden-otlp.input.json", import.meta.url),
);
const expectedPath = fileURLToPath(
  new URL("../fixtures/golden-adapter-evidence.expected.json", import.meta.url),
);

const otlpPayload = JSON.parse(readFileSync(otlpInputPath, "utf8"));
const expectedEvents = JSON.parse(readFileSync(expectedPath, "utf8")) as EvidenceEvent[];

describe("telemetry adapters", () => {
  it("maps OTLP JSON to the golden evidence fixture", () => {
    const spans = parseOtlpJson(otlpPayload);
    const mapper = new TelemetryEvidenceMapper({ accountId: "fallback-account" });
    expect(mapper.mapSpans(spans)).toEqual(expectedEvents);
  });

  it("records success as started, finished, and outcome events", () => {
    const spans = parseJsonRecords([
      {
        id: "span-1",
        traceId: "trace-1",
        name: "ticket-triage",
        startedAt: "2026-08-22T10:00:00.000Z",
        endedAt: "2026-08-22T10:00:01.200Z",
        status: "ok",
        attributes: {
          "roi.workflow_key": "ticket-triage",
          "roi.policy_key": "ticket-triage",
          "roi.outcome_id": "ticket-99",
        },
      },
    ]);
    const events = new TelemetryEvidenceMapper({ accountId: "demo-account" }).mapSpans(spans);
    expect(events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_finished",
      "outcome_completed",
    ]);
    expect(events[1]).toMatchObject({ activeDurationMs: 1200, status: "succeeded" });
  });

  it("records failures with allowlisted exception categories", () => {
    const spans = parseJsonRecords([
      {
        id: "span-fail",
        name: "ticket-triage",
        startedAt: "2026-08-22T10:00:00.000Z",
        endedAt: "2026-08-22T10:00:00.500Z",
        status: "error",
        attributes: {
          "roi.workflow_key": "ticket-triage",
          "roi.policy_key": "ticket-triage",
        },
      },
    ]);
    const events = new TelemetryEvidenceMapper({ accountId: "demo-account" }).mapSpans(spans);
    expect(events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_finished",
      "exception_recorded",
    ]);
    expect(events[2]).toMatchObject({ category: "TelemetryError" });
    expect(events[2]).not.toHaveProperty("safeMessage");
  });

  it("drops unmapped spans", () => {
    const spans = parseJsonRecords([
      {
        id: "span-unknown",
        name: "http.request",
        startedAt: "2026-08-22T10:00:00.000Z",
        endedAt: "2026-08-22T10:00:00.500Z",
        status: "ok",
      },
    ]);
    const events = new TelemetryEvidenceMapper({ accountId: "demo-account" }).mapSpans(spans);
    expect(events).toEqual([]);
  });

  it("strips prompt-like attributes", () => {
    const sanitized = sanitizeAttributes({
      prompt: "secret",
      "roi.workflow_key": "ticket-triage",
      email: "user@example.com",
    });
    expect(sanitized).toEqual({ "roi.workflow_key": "ticket-triage" });
  });

  it("drops spans with missing duration in span mode", () => {
    const spans = parseJsonRecords([
      {
        id: "span-no-duration",
        name: "ticket-triage",
        startedAt: "2026-08-22T10:00:00.000Z",
        status: "ok",
        attributes: {
          "roi.workflow_key": "ticket-triage",
          "roi.policy_key": "ticket-triage",
        },
      },
    ]);
    expect(() => new TelemetryEvidenceMapper({ accountId: "demo-account", durationMode: "span" }).mapSpans(spans)).toThrow("completion timestamp");
  });

  it("skips duplicate event ids on replay ingest", async () => {
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    const spans = parseOtlpJson(otlpPayload);
    const events = new TelemetryEvidenceMapper({ accountId: "fallback-account" }).mapSpans(spans);
    const first = await ingestTelemetryEvidence(repository, events);
    const second = await ingestTelemetryEvidence(repository, events);
    expect(first.appended).toHaveLength(events.length);
    expect(second.skipped).toBe(events.length);
    expect(second.appended).toEqual([]);
    expect(await repository.getWatermark("demo-account")).toBe(String(events.length));
    await repository.close();
  });

  it("ingestOtlpJson runs parse, map, and ingest in one call", async () => {
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    const first = await ingestOtlpJson(repository, otlpPayload, { accountId: "fallback-account" });
    const second = await ingestOtlpJson(repository, otlpPayload, { accountId: "fallback-account" });
    expect(first.spans).toBe(1);
    expect(first.mapped).toBe(expectedEvents.length);
    expect(first.appended).toHaveLength(expectedEvents.length);
    expect(second.skipped).toBe(expectedEvents.length);
    expect(second.appended).toEqual([]);
    await repository.close();
  });
});
