import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TelemetryEvidenceMapper, parseOtlpJson } from "../dist/adapters.js";

const inputPath = fileURLToPath(
  new URL("../fixtures/golden-otlp.input.json", import.meta.url),
);
const outputPath = fileURLToPath(
  new URL("../fixtures/golden-adapter-evidence.expected.json", import.meta.url),
);

const payload = JSON.parse(readFileSync(inputPath, "utf8"));
const spans = parseOtlpJson(payload);
const mapper = new TelemetryEvidenceMapper({ accountId: "fallback-account" });
const events = mapper.mapSpans(spans);
writeFileSync(outputPath, `${JSON.stringify(events, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
