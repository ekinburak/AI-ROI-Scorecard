# Changelog

## 0.2.0

- Matching npm and Python CLIs import existing OTLP/JSON, preserve approved policy versions,
  and generate weekly reports from a watermark-bounded SQLite ledger.
- Snapshot schema v2 values completed outcomes without fabricating runtime. Missing or partial
  measurements withhold hours-saved claims; explicit zero remains measured. V1 snapshots and
  historical hashes remain readable.
- SQLite and PostgreSQL support atomic replay ingestion and reject conflicting payloads without
  partial writes. npm bundles preserve `node:sqlite` and require Node 22.13+.
- Includes provider-neutral telemetry adapters, the embeddable CFO dashboard, input limits,
  report escaping, shared fixtures, documentation, and installed-artifact release checks.

Publication and deployment evidence is tracked in `docs/readiness-checklist.md`.
