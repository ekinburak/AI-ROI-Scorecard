# Telemetry adapters — status checklist

Track what is **shipped**, what **works today via OTLP export** (fastest path), and what is
**waiting**. Update this file when adapter scope changes.

**Fastest path for Langfuse, Datadog, Honeycomb, and LangSmith:** export spans as **OTLP JSON**
and call `ingestOtlpJson`. No vendor SDK or API key required.

```ts
import { ingestOtlpJson } from "ai-roi-scorecard/adapters";

const result = await ingestOtlpJson(repository, otlpPayload, {
  accountId: "fallback-account",
});
// result.spans → parsed, result.mapped → evidence events, result.appended → new rows
```

Full guide: [adapters.md](adapters.md)

---

## 1. Core adapter infrastructure

| Status | Item | TypeScript | Python |
| --- | --- | --- | --- |
| Done | Normalized span type | `NormalizedTelemetrySpan` | `NormalizedTelemetrySpan` |
| Done | Evidence mapper | `TelemetryEvidenceMapper` | `TelemetryEvidenceMapper` |
| Done | Deduping ingest | `ingestTelemetryEvidence` | `ingest_telemetry_evidence` |
| Done | One-call OTLP pipeline | `ingestOtlpJson` | `ingest_otlp_json` |
| Done | One-call JSON pipeline | `ingestJsonRecords` | `ingest_json_records` |
| Done | `roi.*` semantic tags | `ROI_SEMANTIC_ATTRIBUTES` | `ROI_SEMANTIC_ATTRIBUTES` |
| Done | PII attribute stripping | `sanitizeAttributes` | `sanitize_attributes` |
| Done | Composite replay-safe event ids | `{spanId}:started` / `:finished` / `:outcome` | same |
| Done | Golden OTLP fixture + tests | `fixtures/golden-otlp.input.json` | `tests/test_adapters.py` |
| Done | Runnable example | `examples/adapters/otel-batch.mjs` | — |

---

## 2. Input parsers

| Status | Parser | Accepts | Notes |
| --- | --- | --- | --- |
| Done | `parseOtlpJson` / `parse_otlp_json` | OTLP JSON `resourceSpans` | **Recommended for all OTel-compatible tools** |
| Done | `parseJsonRecords` / `parse_json_records` | Generic JSON log array | Map PostHog/webhooks to this shape |
| Waiting | Langfuse native JSON parser | Langfuse trace export format | Use OTLP export today |
| Waiting | Datadog native JSON parser | Datadog APM JSON | Use OTLP export today |
| Waiting | LangSmith native JSON parser | LangSmith run export | Use OTLP export today |
| Waiting | PostHog native JSON parser | PostHog event schema | Use `parseJsonRecords` today |
| Waiting | Honeycomb native JSON parser | Honeycomb event JSON | Use OTLP export today |

---

## 3. Vendor compatibility (via OTLP export — no native parser needed)

These work **today** if the tool can export OpenTelemetry JSON and spans include `roi.*` tags
(or you supply a `TelemetryEvidenceMapper` resolver config).

| Status | Tool | How to connect today | Native parser |
| --- | --- | --- | --- |
| Works | OpenTelemetry Collector | Export batch as OTLP JSON → `ingestOtlpJson` | N/A (first-class) |
| Works | Langfuse | Enable OTel export → `ingestOtlpJson` | Waiting |
| Works | Datadog | OTel ingest / export → `ingestOtlpJson` | Waiting |
| Works | Honeycomb | OTel export → `ingestOtlpJson` | Waiting |
| Works | LangSmith | OTel-compatible export → `ingestOtlpJson` | Waiting |
| Works | Custom OTel SDK | Instrument with `roi.*` attributes → collector → `ingestOtlpJson` | N/A |
| Partial | PostHog | Map events to `parseJsonRecords` shape → `ingestJsonRecords` | Waiting |
| Partial | Segment / webhooks | Transform payload → `parseJsonRecords` | Waiting |

**Partial** = works with a small host-side transform, not a dedicated parser.

---

## 4. Required span tags (your instrumentation)

| Status | Tag | Required for |
| --- | --- | --- |
| Host | `roi.account_id` | Multi-tenant ledger (or set `accountId` in mapper config) |
| Host | `roi.workflow_key` | Workflow line on scorecard |
| Host | `roi.policy_key` | Links to approved manual-time baseline |
| Host | `roi.outcome_id` | Valuing a completed business unit |
| Host | `roi.units` | Optional; default `1` |

Without `roi.outcome_id` on success spans, you get runtime evidence but **no dollars**.

---

## 5. Host responsibilities (not adapter work)

| Status | Item | Provided by |
| --- | --- | --- |
| Host | Value policies (`manualMinutesPerUnit`) | Your governance / admin UI |
| Host | Valuation (`hourlyValueMinor`, `serviceCostMinor`) | Your finance / contract config |
| Host | Business outcome definition | Your `recordOutcome` rule or `roi.outcome_id` tagging |
| Host | Evidence repository (SQLite, Postgres, custom) | Your infrastructure |
| Host | Ingest job (cron, webhook handler, collector sidecar) | Your pipeline |
| Host | Dashboard refresh + auth | Your application |
| Host | Period boundaries (open week vs sealed) | Your product rules |

---

## 6. Explicitly out of scope

| Status | Item | Reason |
| --- | --- | --- |
| Won't ship (v1) | Langfuse / Datadog / PostHog REST clients | Provider-neutral; hosts own credentials |
| Won't ship (v1) | Webhook server inside SDK | Host receives telemetry |
| Won't ship (v1) | Token counts → dollars | Not a business outcome |
| Won't ship (v1) | HTTP 200 → dollars | Not a business outcome |
| Done (0.2.0) | Optional runtime and schema v2 | Approved outcomes can be valued without runtime; v1 snapshots remain readable |

---

## 7. Go-live checklist (copy for your team)

### Instrumentation

- [ ] Completed work spans tagged with `roi.workflow_key`, `roi.policy_key`, `roi.outcome_id`
- [ ] Spans include start and end timestamps (for measured runtime / hours saved)
- [ ] No prompts, emails, or stack traces in span attributes

### Ingest pipeline

- [ ] OTLP JSON export configured (collector, Langfuse, Datadog, etc.)
- [ ] Ingest job calls `ingestOtlpJson` (or `parse` → `map` → `ingestTelemetryEvidence`)
- [ ] Replay tested: second run increments `skipped`, not `appended`

### Scorecard data

- [ ] Policies stored with matching `policyKey` and effective dates
- [ ] Valuation approved for reporting period
- [ ] `generateScorecard` returns `status: "ready"` for a test week

### Dashboard

- [ ] Open week regenerates snapshot on new evidence
- [ ] Sealed weeks load stored snapshot by fingerprint
- [ ] CFO view shows dollars; hours saved only when runtime is measured

---

## 8. Recommended next implementations (priority order)

1. **Waiting** — Langfuse native JSON parser (convenience only; OTLP already works)
2. **Waiting** — Datadog native JSON parser
3. **Waiting** — PostHog native JSON parser
4. **Waiting** — LangSmith native JSON parser

Contributions should add a `parse*` function returning `NormalizedTelemetrySpan[]` — no vendor
SDK in the core package.

Public release evidence: [readiness-checklist.md](readiness-checklist.md). CLI setup: [cli.md](cli.md).
