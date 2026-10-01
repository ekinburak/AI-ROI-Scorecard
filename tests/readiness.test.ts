import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { canonicalJson, generateScorecard, ScorecardSnapshotSchema, sha256Canonical, toDashboardViewModel } from "../src/index.js";
import { ingestOtlpJson, parseOtlpJson, TelemetryEvidenceMapper, parseJsonRecords } from "../src/adapters/index.js";
import { SqliteScorecardRepository } from "../src/storage/sqlite.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const input = () => load("golden-v1.input.json");
const payload = () => load("golden-otlp.input.json");

describe("release regressions", () => {
  it("keeps v1 wire values and historical hashes unchanged", async () => {
    const legacy = load("golden-v1.expected.json");
    expect(ScorecardSnapshotSchema.parse(legacy)).toEqual(legacy);
    const { snapshotHash, ...body } = legacy;
    expect(sha256Canonical(body)).toBe(snapshotHash);
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    await repository.putSnapshot(legacy);
    expect(await repository.getSnapshotByFingerprint(legacy.accountId, legacy.sourceFingerprint)).toEqual(legacy);
    await repository.close();
  });

  it("values completed work without claiming measured savings", () => {
    const value = input();
    for (const event of value.events) if (event.type === "attempt_finished") delete event.activeDurationMs;
    const snapshot = generateScorecard(value);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.totals.estimatedValueMinor).toBe("27500");
    expect(snapshot.runtimeMeasurement).toBe("not_provided");
    expect(snapshot.totals.timeSavedMs).toBeNull();
    expect(snapshot.lineItems.every((line) => line.runtimeMeasurement === "not_provided")).toBe(true);
    expect(toDashboardViewModel(snapshot).hoursHeroLabel).toBe("Manual hours replaced");
  });

  it("distinguishes measured zero from omitted and mixed runtime", () => {
    const value = input();
    for (const event of value.events) if (event.type === "attempt_finished") event.activeDurationMs = 0;
    expect(generateScorecard(value).runtimeMeasurement).toBe("measured");
    const finish = value.events.filter((event: any) => event.type === "attempt_finished")[1];
    delete finish.activeDurationMs;
    const mixed = generateScorecard(value);
    expect(mixed.runtimeMeasurement).toBe("partial");
    expect(mixed.totals.timeSavedMs).toBeNull();
    expect(mixed.lineItems.some((line) => line.runtimeMeasurement === "partial")).toBe(true);
    expect(toDashboardViewModel(mixed).usageAiRuntime).toBe("Partially measured");
  });

  it("omits duration in omit mode and rejects invalid units", () => {
    const spans = parseOtlpJson(payload());
    const mapper = new TelemetryEvidenceMapper({accountId:"demo-account", durationMode:"omit"});
    expect(mapper.mapSpans(spans).find((event) => event.type === "attempt_finished")).not.toHaveProperty("activeDurationMs");
    for (const units of [0, -1, 1.5, "1.5", true, 1_000_000_001]) {
      const span = structuredClone(spans[0]!);
      span.attributes["roi.units"] = units;
      expect(() => mapper.mapSpans([span])).toThrow();
    }
    expect(() => parseJsonRecords([{id:"a",name:"x",startedAt:"invalid",endedAt:"invalid"}])).toThrow();
  });

  it("deduplicates batches and rolls back conflicts without cursor gaps", async () => {
    const repository = new SqliteScorecardRepository();
    await repository.migrate();
    const value = payload();
    const spans = value.resourceSpans[0].scopeSpans[0].spans;
    spans.push(structuredClone(spans[0]));
    const first = await ingestOtlpJson(repository, value, {accountId:"demo-account"});
    expect(first.appended).toHaveLength(3);
    expect(first.skipped).toBe(3);
    const outcomes = await Promise.all(Array.from({length:8}, () => ingestOtlpJson(repository,value,{accountId:"demo-account"})));
    expect(outcomes.every((result) => result.appended.length === 0 && result.skipped === 6)).toBe(true);
    const events = new TelemetryEvidenceMapper({accountId:"demo-account"}).mapSpans(parseOtlpJson(payload()));
    const conflicting = events.map((event) => ({...event, workflowKey:"different"}));
    await expect(repository.appendIfAbsent([{...events[0]!,eventId:"fresh"}, ...conflicting])).rejects.toThrow("Conflicting evidence");
    expect(await repository.getWatermark("demo-account")).toBe("3");
    expect(await repository.getEvents("demo-account")).toHaveLength(3);
    expect(canonicalJson(await repository.getEvents("demo-account"))).not.toContain("fresh");
    await repository.close();
  });

  it("fingerprints distinguish schema, locale and generation timestamp", () => {
    const value = input();
    const snapshot = generateScorecard(value);
    expect(snapshot.sourceFingerprint).not.toBe(load("golden-v1.expected.json").sourceFingerprint);
    expect(generateScorecard({...value,locale:"fr"}).sourceFingerprint).not.toBe(snapshot.sourceFingerprint);
    expect(generateScorecard({...value,generatedAt:"2026-08-28T09:00:00.000Z"}).sourceFingerprint).not.toBe(snapshot.sourceFingerprint);
  });
});
