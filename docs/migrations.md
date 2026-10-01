# Snapshot schema migration

Version 0.2.0 generates snapshot schema **2**. The reader and repositories continue accepting
schema **1** snapshots. Loading or rendering a historical snapshot preserves its wire values,
source fingerprint, and snapshot hash; no database migration rewrites stored reports.

Schema v2 changes:

- `attempt_finished.activeDurationMs` may be omitted. Explicit `0` is a measured duration.
- Snapshot and line runtime states are `measured`, `partial`, and `not_provided`.
- `totals.timeSavedMs` is `null` unless all relevant runtime is measured and lifecycles are complete.
- Completed outcomes remain eligible for approved baseline valuation without measured runtime.
- New source fingerprints include schema version, locale, and generation timestamp. Different
  presentation locales and generation instants can coexist at the same ledger watermark.

Consumers must branch on `runtimeMeasurement` and handle nullable savings. Show **Hours saved**
only for `measured` runtime. For missing or partial runtime show **Manual hours replaced** and
label any provided runtime as partial. Dollar values remain estimates based on approved manual
baselines and hourly valuation, including when runtime is measured.

No evidence-table migration is needed: events are stored as JSON. Previously stored measured
finishes remain valid. The schema-v1 JSON schema stays available at
[`schema/scorecard-v1.schema.json`](../schema/scorecard-v1.schema.json); the current shared schema
is [`schema/scorecard-v2.schema.json`](../schema/scorecard-v2.schema.json).

`append` remains strict about duplicate event IDs. Built-in repositories add atomic
`appendIfAbsent` / `append_if_absent`: exact replays ignore assigned ledger sequence, conflicting
payloads fail, and the whole batch rolls back. Custom repositories without that method use the
adapter's compatibility fallback and **require a single writer**. Implement the atomic method
before allowing concurrent ingest jobs against a custom repository.
