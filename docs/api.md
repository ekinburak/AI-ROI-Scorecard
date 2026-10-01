# API map

## Shared core

| TypeScript | Python | Purpose |
| --- | --- | --- |
| `generateScorecard` | `generate_scorecard` | Generate an audited immutable snapshot. |
| `estimateScorecard` | `estimate_scorecard` | Generate a clearly illustrative snapshot. |
| `canonicalJson` | `canonical_json` | Serialize a stable canonical JSON value. |
| `sha256Canonical` | `sha256_canonical` | Hash canonical JSON. |
| `toReportViewModel` | renderer helpers | Convert a snapshot to presentation values. |
| `renderHtmlReport` | `render_html_report` | Render standalone escaped HTML. |
| `renderTextReport` | `render_text_report` | Render the matching text report. |
| `renderReport` | `render_report` | Render both formats and artifact hash. |
| `toDashboardViewModel` | `to_dashboard_view_model` | Convert a snapshot to CFO dashboard labels. |

## Dashboard embed

| TypeScript | Purpose |
| --- | --- |
| `registerAiRoiDashboard` | Register the `<ai-roi-dashboard>` custom element. |
| `AiRoiDashboardElement` | HTMLElement with `snapshot` and `dashboardOptions` properties. |
| `AiRoiDashboard` (`dashboard/react`) | Thin React wrapper around the custom element. |

Import paths: `ai-roi-scorecard/dashboard` and `ai-roi-scorecard/dashboard/react`.

## Instrumentation

| TypeScript | Python |
| --- | --- |
| `instrumentAsync` | `instrument_async` |
| `instrumentSync` | `instrument_sync` |
| — | `track_workflow` |
| — | `workflow_attempt` |

## Storage

TypeScript exports repository contracts from `ai-roi-scorecard/storage`, SQLite from
`ai-roi-scorecard/storage/sqlite`, and PostgreSQL from `ai-roi-scorecard/storage/postgres`.

Python exports the repository protocol and both adapters from `ai_roi_scorecard`.

## Telemetry adapters

Import: `ai-roi-scorecard/adapters` (TypeScript), `ai_roi_scorecard.adapters` (Python).

**Implementation guide:** [Telemetry adapters](adapters.md)

| TypeScript | Python | Purpose |
| --- | --- | --- |
| `ingestOtlpJson` | `ingest_otlp_json` | **Fastest path:** OTLP JSON → map → deduping ingest |
| `ingestJsonRecords` | `ingest_json_records` | Generic JSON records → map → deduping ingest |
| `parseOtlpJson` | `parse_otlp_json` | OTLP JSON `resourceSpans` → `NormalizedTelemetrySpan[]` |
| `parseJsonRecords` | `parse_json_records` | Generic JSON log records → spans |
| `TelemetryEvidenceMapper` | `TelemetryEvidenceMapper` | Spans → `EvidenceEvent[]` via semantic tags or resolvers |
| `ingestTelemetryEvidence` | `ingest_telemetry_evidence` | Append to repository; skip duplicate `eventId`s on replay |
| `ROI_SEMANTIC_ATTRIBUTES` | `ROI_SEMANTIC_ATTRIBUTES` | Canonical `roi.account_id`, `roi.workflow_key`, etc. |
| `sanitizeAttributes` | `sanitize_attributes` | Strip PII-like keys before mapping |

**Status checklist:** [adapters-checklist.md](adapters-checklist.md)

## Wire types

Both packages expose evidence event variants, localized value policies, valuation context, report
periods, generation input, estimate input, line items, totals, and immutable snapshots. JSON uses
camelCase in both languages; Python models accept and expose idiomatic snake_case attributes.

Illustrative workflows may supply `valueGroupKey`, `valueGroupLabel`, and an
`hourlyValueMinor` override. They may omit `aiDurationMs` when no measured runtime exists. The
result then records `runtimeMeasurement` as `not_provided` instead of presenting zero as a
measurement. These estimate-only fields never attach monetary values to instrumentation tags.

## Input limits

The SDK rejects oversized inputs before sorting, hashing, or numeric conversion. Audited generation
accepts at most 10,000 events and 1,000 policies; illustrative generation accepts at most 1,000
workflows. Identifiers are limited to 256 characters, labels to 512 characters, locales to 64
characters, localized labels to 32 translations, and decimal integer inputs to 128 digits. Numeric
input fields are limited to 1,000,000,000; bounded derived integer values may contain up to 160
digits. Hosts should enforce lower request and tenant limits when their operating envelope requires
them; inputs are rejected rather than truncated.
