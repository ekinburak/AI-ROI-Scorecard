# Generic integration examples

These examples demonstrate the complete public boundary of the SDK.

## Native instrumentation path

Simulates customer-support automation with `instrumentAsync` / `track_workflow`:

1. instrument work with a stable `policyKey`;
2. append measured evidence;
3. apply an approved manual-time baseline;
4. generate an immutable weekly scorecard; and
5. render HTML and text (or embed the CFO dashboard).

Run TypeScript after `pnpm build`:

```bash
node examples/typescript/support-automation.mjs
node examples/dashboard/live-host.mjs
```

Open `examples/dashboard/index.html` in a browser (or serve the repository root) to watch the live
CFO dashboard demo update every four seconds.

Run Python after `cd python && uv sync`:

```bash
cd python
uv run python ../examples/python/support_automation.py
```

Both use in-memory evidence. Replace the sink with SQLite, PostgreSQL, or a custom repository in
production.

## Telemetry adapter path (brownfield)

Use this when you **already have spans or JSON logs** from OpenTelemetry, Langfuse, Datadog,
PostHog, or a custom pipeline.

```bash
node examples/adapters/otel-batch.mjs
```

What it does:

1. Loads `fixtures/golden-otlp.input.json` (sample OTLP export with `roi.*` tags).
2. Parses with `parseOtlpJson`.
3. Maps with `TelemetryEvidenceMapper`.
4. Ingests via `ingestTelemetryEvidence` (demonstrates replay skip).
5. Calls `generateScorecard` with a matching policy and valuation.

**Full implementation guide:** [docs/adapters.md](../docs/adapters.md)

**Status checklist (done vs waiting):** [docs/adapters-checklist.md](../docs/adapters-checklist.md)

### Minimal adapter integration (fastest — OTLP)

```ts
import { generateScorecard } from "ai-roi-scorecard";
import { ingestOtlpJson } from "ai-roi-scorecard/adapters";

await ingestOtlpJson(repository, otlpPayload, { accountId: "fallback" });

const snapshot = generateScorecard({
  accountId: "demo-account",
  period: openWeek,
  generatedAt: new Date().toISOString(),
  events: await repository.getEvents("demo-account"),
  policies: await repository.getPolicies("demo-account"),
  valuation: approvedValuation,
});
```

You must still `putPolicy` and supply valuation — adapters do not provide manual minutes or hourly
rates. See the go-live checklist in [docs/adapters.md](../docs/adapters.md).
