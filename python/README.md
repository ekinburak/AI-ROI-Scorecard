# AI ROI Scorecard for Python

The Python package provides the same versioned scorecard schema, deterministic calculations,
instrumentation helpers, report renderers, and storage contracts as the TypeScript SDK.

```bash
pip install ai-roi-scorecard
```

Python 3.11 or newer is required. See the repository root documentation for concepts and examples.

## Brownfield: existing telemetry

If you already use OpenTelemetry or another log pipeline instead of `track_workflow`, use
`ai_roi_scorecard.adapters` to map spans into evidence events. See
[Telemetry adapters](../docs/adapters.md) for the full implementation guide.

## Command line (0.2.0)

Use `ai-roi-scorecard` or `python -m ai_roi_scorecard` with Python 3.11+.
The [CLI walkthrough](../docs/cli.md) covers SQLite initialization, telemetry imports, approved
policies, reports, illustrative estimates, stdin, output formats, and exit codes. JSON contracts
and hashes match npm. Schema-v1 snapshots remain readable; new schema-v2 reports use nullable
`timeSavedMs` when runtime is missing or partial.
