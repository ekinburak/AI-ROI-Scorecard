#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { canonicalJson } from "./canonical.js";
import { estimateScorecard, generateScorecard } from "./calculate.js";
import { renderHtmlReport, renderTextReport } from "./render.js";
import { GenerationInputSchema, ScorecardSnapshotSchema, ValuePolicySchema, type ScorecardSnapshot } from "./schemas.js";
import { parseJsonRecords, parseOtlpJson, TelemetryEvidenceMapper, ingestTelemetryEvidence, readSemanticNumber, readSemanticString, type JsonTelemetryRecord, type NormalizedTelemetrySpan, type TelemetryMapping } from "./adapters/index.js";
import { SqliteScorecardRepository } from "./storage/sqlite.js";

const HELP = `AI ROI Scorecard 0.2.0
Usage: ai-roi-scorecard <command> [options]
  init --db FILE
  ingest --db FILE --account ID --input FILE|- --input-format otlp|json
         [--mapping FILE] [--duration-mode span|omit]
  policies import --db FILE --input FILE|-
  report --db FILE --input FILE|- [--generated-at ISO]
  estimate --input FILE|-
  render --input FILE|- [--format text|html]
Options: --format json|text|html --output FILE --help --version
Report request: {accountId, period, valuation, locale?}
Exit codes: 0 success; 1 operational error; 2 invalid input; 3 report needs attention.
`;

const MappingSchema = z.object({
  attributes: z.object({ workflowKey: z.string().optional(), policyKey: z.string().optional(), outcomeId: z.string().optional(), units: z.string().optional() }).strict().default({}),
  workflowsByName: z.record(z.string(), z.object({workflowKey: z.string(), policyKey: z.string()}).strict()).default({}),
}).strict();
const ReportRequestSchema = GenerationInputSchema.omit({ events: true, policies: true, generatedAt: true, evidenceWatermark: true }).strict();
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

async function readJson(path: string): Promise<unknown> {
  let data: Buffer;
  if (path === "-") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) throw new RangeError("Input exceeds 16 MiB");
      chunks.push(bytes);
    }
    data = Buffer.concat(chunks);
  } else {
    const handle = await import("node:fs/promises").then(({open}) => open(path));
    try {
      if ((await handle.stat()).size > MAX_INPUT_BYTES) throw new RangeError("Input exceeds 16 MiB");
      data = await handle.readFile();
    } finally { await handle.close(); }
  }
  return JSON.parse(data.toString("utf8"));
}

function mapping(config: z.infer<typeof MappingSchema>, accountId: string, mode: "span" | "omit"): TelemetryMapping {
  const attribute = (span: NormalizedTelemetrySpan, key: keyof typeof config.attributes) => {
    const name = config.attributes[key];
    return name === undefined ? undefined : readSemanticString(span.attributes, name);
  };
  return {
    accountId, durationMode: mode,
    workflowKey: (span) => attribute(span, "workflowKey") ?? config.workflowsByName[span.name]?.workflowKey,
    policyKey: (span) => attribute(span, "policyKey") ?? config.workflowsByName[span.name]?.policyKey,
    outcomeId: (span) => attribute(span, "outcomeId"),
    units: (span) => config.attributes.units === undefined ? undefined : readSemanticNumber(span.attributes, config.attributes.units),
  };
}

function reportOutput(snapshot: ScorecardSnapshot, format: string): string {
  if (format === "json") return canonicalJson(snapshot);
  if (format === "text") return renderTextReport(snapshot);
  return renderHtmlReport(snapshot);
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  let repository: SqliteScorecardRepository | undefined;
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      db: {type:"string"}, account: {type:"string"}, input: {type:"string"}, "input-format": {type:"string"}, mapping: {type:"string"}, "duration-mode": {type:"string"}, "generated-at": {type:"string"}, format: {type:"string"}, output: {type:"string"}, help: {type:"boolean"}, version: {type:"boolean"},
    }});
    if (values.version) { process.stdout.write("0.2.0\n"); return 0; }
    if (values.help || positionals.length === 0) { process.stdout.write(HELP); return 0; }
    const command = positionals.join(" ");
    if (!["init", "ingest", "policies import", "report", "estimate", "render"].includes(command)) throw new TypeError("Unknown command");
    const required = (name: "input" | "db" | "account" | "input-format") => {
      const value = values[name];
      if (!value) throw new TypeError(`--${name} is required`);
      return value;
    };
    const allowed: Record<string, string[]> = {
      init:["db"], ingest:["db","account","input","input-format","mapping","duration-mode","output"],
      "policies import":["db","input","output"], report:["db","input","generated-at","format","output"],
      estimate:["input","format","output"], render:["input","format","output"],
    };
    if (Object.keys(values).some((key) => !allowed[command]!.includes(key))) throw new TypeError("Option is not supported for this command");
    const format = values.format ?? (command === "render" ? "text" : "json");
    if (!["json","text","html"].includes(format) || command === "render" && format === "json") throw new TypeError("Invalid output format");
    let result: unknown;
    let snapshot: ScorecardSnapshot | undefined;
    if (command === "estimate") snapshot = estimateScorecard(await readJson(required("input")));
    else if (command === "render") snapshot = ScorecardSnapshotSchema.parse(await readJson(required("input")));
    else {
      const db = required("db");
      if (command === "ingest") {
        const accountId = z.string().min(1).max(256).parse(required("account"));
        const inputFormat = required("input-format");
        if (inputFormat !== "otlp" && inputFormat !== "json") throw new TypeError("Invalid input format");
        const mode = values["duration-mode"] ?? "span";
        if (mode !== "span" && mode !== "omit") throw new TypeError("Invalid duration mode");
        const payload = await readJson(required("input"));
        const config = MappingSchema.parse(values.mapping ? await readJson(values.mapping) : {});
        const spans = inputFormat === "otlp" ? parseOtlpJson(payload as Parameters<typeof parseOtlpJson>[0]) : parseJsonRecords(payload as JsonTelemetryRecord[]);
        if (spans.some((span) => { const id = readSemanticString(span.attributes,"roi.account_id"); return id !== undefined && id !== accountId; })) throw new TypeError("Telemetry account conflicts with --account");
        const events = new TelemetryEvidenceMapper(mapping(config, accountId, mode)).mapSpans(spans);
        repository = new SqliteScorecardRepository(db); await repository.migrate();
        const ingested = await ingestTelemetryEvidence(repository, events);
        result = {spans:spans.length, mapped:events.length, appended:ingested.appended.length, skipped:ingested.skipped};
        if (spans.length && !events.length) process.stderr.write("No spans mapped: supply roi.* tags or --mapping.\n");
      } else if (command === "policies import") {
        const policies = z.array(ValuePolicySchema).max(1000).parse(await readJson(required("input")));
        repository = new SqliteScorecardRepository(db); await repository.migrate();
        const known = new Map<string, string>();
        for (const policy of policies) {
          for (const stored of await repository.getPolicies(policy.accountId ?? "")) {
            known.set(JSON.stringify([stored.policyKey, stored.version, stored.scope, stored.accountId ?? ""]), canonicalJson(stored));
          }
        }
        for (const policy of policies) {
          const key = JSON.stringify([policy.policyKey, policy.version, policy.scope, policy.accountId ?? ""]);
          const payload = canonicalJson(policy);
          if (known.has(key) && known.get(key) !== payload) throw new TypeError("Policy versions are immutable");
          known.set(key, payload);
        }
        for (const policy of policies) await repository.putPolicy(policy);
        result = { imported:policies.length };
      } else if (command === "report") {
        const request = ReportRequestSchema.parse(await readJson(required("input")));
        repository = new SqliteScorecardRepository(db); await repository.migrate();
        const watermark = await repository.getWatermark(request.accountId);
        snapshot = generateScorecard({...request, generatedAt:values["generated-at"] ?? new Date().toISOString(), evidenceWatermark:watermark, events:await repository.getEvents(request.accountId,{throughSequence:watermark}), policies:await repository.getPolicies(request.accountId)});
        await repository.putSnapshot(snapshot);
      } else {
        repository = new SqliteScorecardRepository(db); await repository.migrate(); result = { initialized:true };
      }
    }
    const output = (snapshot ? reportOutput(snapshot,format) : canonicalJson(result)) + "\n";
    if (values.output) await writeFile(values.output, output, "utf8");
    else process.stdout.write(output);
    return snapshot?.status === "needs_attention" ? 3 : 0;
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError || error instanceof Error && (error.name === "TypeError" || /Conflicting evidence|immutable/i.test(error.message));
    const message = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "Operation failed";
    process.stderr.write(`ai-roi-scorecard: ${message}\n`);
    return invalid ? 2 : 1;
  } finally { await repository?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) void runCli().then((code) => { process.exitCode = code; });
