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

## Wire types

Both packages expose evidence event variants, localized value policies, valuation context, report
periods, generation input, estimate input, line items, totals, and immutable snapshots. JSON uses
camelCase in both languages; Python models accept and expose idiomatic snake_case attributes.

Illustrative workflows may supply `valueGroupKey`, `valueGroupLabel`, and an
`hourlyValueMinor` override. They may omit `aiDurationMs` when no measured runtime exists. The
result then records `runtimeMeasurement` as `not_provided` instead of presenting zero as a
measurement. These estimate-only fields never attach monetary values to instrumentation tags.
