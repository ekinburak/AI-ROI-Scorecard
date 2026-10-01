# AI ROI Scorecard

[![CI](https://github.com/ekinburak/AI-ROI-Scorecard/actions/workflows/ci.yml/badge.svg)](https://github.com/ekinburak/AI-ROI-Scorecard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ai-roi-scorecard)](https://www.npmjs.com/package/ai-roi-scorecard)
[![PyPI](https://img.shields.io/pypi/v/ai-roi-scorecard)](https://pypi.org/project/ai-roi-scorecard/)

Turn completed AI work into an auditable weekly value scorecard. The SDK records workflow
evidence, applies approved manual-time baselines, measures active AI runtime, and produces a
deterministic snapshot that can be rendered as HTML or plain text.

It is provider-neutral. It does not send email, schedule jobs, select recipients, authenticate
users, or decide what one hour is worth. Those remain explicit responsibilities of the host
application.

## Install

TypeScript or JavaScript:

```bash
npm install ai-roi-scorecard@0.2.0
```

Python 3.11 or newer:

```bash
pip install ai-roi-scorecard
```

PostgreSQL support in Python is optional:

```bash
pip install "ai-roi-scorecard[postgres]"
```

## Use the CLI

Node 22.13+ and Python 3.11+ expose `ai-roi-scorecard`. Python also supports
`python -m ai_roi_scorecard`. Start with [the copyable CLI walkthrough](docs/cli.md):
existing OTLP/JSON → SQLite ledger → approved policies → weekly report.

## Start with an illustrative estimate

TypeScript:

```ts
import { estimateScorecard, renderReport } from "ai-roi-scorecard";

const snapshot = estimateScorecard({
  accountId: "example-team",
  period: {
    start: "2026-08-21T00:00:00.000Z",
    end: "2026-08-28T00:00:00.000Z",
  },
  generatedAt: "2026-08-28T08:00:00.000Z",
  workflows: [
    {
      workflowKey: "support-triage",
      label: "Support ticket triage",
      manualMinutes: 30,
      units: 18,
      aiDurationMs: 42_000,
    },
  ],
  valuation: {
    currency: "USD",
    hourlyValueMinor: "9000",
    serviceCostMinor: "25000",
  },
});

const report = renderReport(snapshot, { accountName: "Example team" });
```

Python:

```python
from ai_roi_scorecard import estimate_scorecard, render_report

snapshot = estimate_scorecard({
    "period": {
        "start": "2026-08-21T00:00:00.000Z",
        "end": "2026-08-28T00:00:00.000Z",
    },
    "generatedAt": "2026-08-28T08:00:00.000Z",
    "workflows": [{
        "workflowKey": "support-triage",
        "label": "Support ticket triage",
        "manualMinutes": 30,
        "units": 18,
        "aiDurationMs": 42_000,
    }],
    "valuation": {
        "currency": "USD",
        "hourlyValueMinor": "9000",
        "serviceCostMinor": "25000",
    },
})

report = render_report(snapshot)
```

Illustrative estimates are marked as such. For an evidence-backed report, record durable events,
store approved policies, capture a ledger watermark, and call `generateScorecard` or
`generate_scorecard`.

## Show this week to a CFO

Embed a live dashboard that highlights **measured hours saved** and **estimated dollars saved** for the open
reporting period:

```bash
npm install ai-roi-scorecard
```

```html
<script type="module">
  import { registerAiRoiDashboard } from "ai-roi-scorecard/dashboard";
  registerAiRoiDashboard();
  document.querySelector("ai-roi-dashboard").snapshot = weeklySnapshot;
</script>
<ai-roi-dashboard period-state="open" audience="cfo"></ai-roi-dashboard>
```

Regenerate the snapshot from evidence as work completes, then assign it to the element. See
[Embeddable CFO dashboard](docs/dashboard.md) for React hosts, styling variables, and sealed weeks.

## Feed from existing telemetry (brownfield)

If you already run OpenTelemetry, Langfuse, Datadog, or a JSON log pipeline, adapters translate
those spans into the same evidence ledger — no vendor SDK inside this package.

```ts
import { ingestOtlpJson, parseOtlpJson, TelemetryEvidenceMapper, ingestTelemetryEvidence } from "ai-roi-scorecard/adapters";

// Fastest: one call (OTLP JSON from Langfuse, Datadog, collector, etc.)
await ingestOtlpJson(repository, otlpPayload, { accountId: "team-42" });
```

Tag completed work with `roi.workflow_key`, `roi.policy_key`, and `roi.outcome_id` on spans when
possible. You still supply approved policies and hourly valuation separately.

**Guides:** [Implementation guide](docs/adapters.md) · [Status checklist](docs/adapters-checklist.md)

## Instrumentation is not valuation

A workflow wrapper or decorator supplies a stable `policyKey`:

```python
@track_workflow(config)
async def draft_customer_reply(ticket: Ticket) -> Draft:
    ...
```

The tag links evidence to a policy. It does **not** contain hours or money. A separate, versioned
policy says how long the work used to take; a valuation context supplies the approved hourly
value. This separation keeps ROI assumptions visible and reviewable instead of hiding them in
source code.

## What is measured

- Completed work: unique successful outcome events.
- Manual time: completed units multiplied by the effective approved baseline.
- AI time: measured active worker runtime, including failed retries but excluding queueing,
  backoff, callbacks, and human waiting.
- Hours saved: manual baseline minus runtime only when runtime is fully measured; otherwise
  reports show manual hours replaced and `timeSavedMs: null`.
- Estimated value: each line's manual minutes multiplied by hourly value and rounded half-up.
- Net value and ROI: shown only when a positive same-period service cost is supplied.
- Exceptions and approvals: explicit evidence events, with exception resolutions tracked
  separately.

All monetary values use decimal strings in minor currency units. Calculations use `bigint` in
TypeScript and `int` in Python. Snapshot and source hashes are identical across both SDKs.

## Documentation

- [CLI walkthrough](docs/cli.md)
- [Public readiness checklist](docs/readiness-checklist.md)
- [Concepts and evidence lifecycle](docs/concepts.md)
- [Calculation rules](docs/calculations.md)
- [Instrumentation](docs/instrumentation.md)
- [SQLite and PostgreSQL storage](docs/storage.md)
- [Telemetry adapters](docs/adapters.md)
- [Telemetry adapters status checklist](docs/adapters-checklist.md)
- [Embeddable CFO dashboard](docs/dashboard.md)
- [HTML and text reports](docs/renderer.md)
- [Policy approval and governance](docs/policy-governance.md)
- [API map](docs/api.md)
- [Security and privacy](docs/security.md)
- [Schema and migration policy](docs/migrations.md)
- [Complete generic examples](examples/README.md)

## Repository layout

- `src/`: TypeScript core, renderer, instrumentation, storage, and telemetry adapters.
- `python/`: Python package with equivalent public behavior.
- `schema/`: shared versioned wire schema.
- `fixtures/`: cross-language golden inputs and outputs.
- `examples/`: generic TypeScript and Python integrations.

## Status

`0.2.0` introduces schema v2 and matching CLIs; schema-v1 snapshots remain readable.
See the [living readiness checklist](docs/readiness-checklist.md) for live publication evidence. Snapshot schema changes follow semantic versioning. The
wire schema is versioned independently through `schemaVersion` so stored reports remain readable.

## License

MIT
