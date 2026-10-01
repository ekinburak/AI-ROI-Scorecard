# AI ROI Scorecard

[![CI](https://github.com/ekinburak/AI-ROI-Scorecard/actions/workflows/ci.yml/badge.svg)](https://github.com/ekinburak/AI-ROI-Scorecard/actions/workflows/ci.yml)

Turn completed AI work into an auditable weekly value scorecard using telemetry you already
collect. Import OTLP or JSON logs, apply approved manual-time baselines and hourly valuation,
and produce a report showing **manual hours replaced**, **estimated dollar value**, and
**hours saved when runtime is fully measured**.

```text
Existing OTLP / JSON → SQLite ledger → Approved policies → Weekly scorecard
```

The matching TypeScript and Python packages provide a CLI, an SDK, and deterministic snapshots.
Reports render as JSON, text, or HTML; JavaScript hosts can also embed the CFO dashboard.
Hosts own scheduling, authentication, delivery, policy approval, and hourly valuation.

## Release status

**0.2.0 is implemented and tested from built packages. Public publication is pending.**
As checked on October 1, 2026:

| Available and tested | Still waiting |
| --- | --- |
| Matching npm/Python CLIs and `python -m ai_roi_scorecard` | Public npm and PyPI 0.2.0 publication |
| Fresh package installs, JavaScript ESM/CommonJS imports, and matching snapshots/hashes | Fresh installations from the public registries |
| Atomic SQLite and PostgreSQL ingestion, including concurrent replays | Publisher account setup and Cloudflare credentials |
| Schema v2 and schema-v1 snapshot compatibility | Updated documentation website deployment and live smoke tests |

The [full SDK CI](https://github.com/ekinburak/AI-ROI-Scorecard/actions/runs/36837127533)
passed Node 22/24/26, Python 3.11–3.14, real PostgreSQL tests, installed-package checks, and
trusted artifact scans. See the [living readiness checklist](docs/readiness-checklist.md)
for release evidence and remaining actions.

## Install from source now

Clone this repository to get the packages and example fixtures:

```sh
git clone https://github.com/ekinburak/AI-ROI-Scorecard.git
cd AI-ROI-Scorecard
```

Choose one installation. For **Node 22.13+**, with **pnpm 10.33.0** installed:

```sh
pnpm install --frozen-lockfile
pnpm pack --pack-destination artifacts
npm install --global ./artifacts/ai-roi-scorecard-0.2.0.tgz
ai-roi-scorecard --version
```

For **Python 3.11+**, in a virtual environment:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install ./python
ai-roi-scorecard --version
python -m ai_roi_scorecard --version
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1` in PowerShell.
Both installations expose `ai-roi-scorecard`; the Python module command always selects Python
if both executables are on your path.

After public 0.2.0 publication, registry installation will be:

```sh
npm install --global ai-roi-scorecard@0.2.0
# Or, in a Python virtual environment:
python -m pip install ai-roi-scorecard==0.2.0
```

SDK consumers install the npm package without `--global`. Python PostgreSQL support is optional:
`python -m pip install "./python[postgres]"` from source, or
`python -m pip install "ai-roi-scorecard[postgres]==0.2.0"` after publication.

## Quick start: telemetry to a weekly report

Run from the repository root after either installation above. The shared fixtures contain one
completed ticket, an example approved 45-minute baseline, and a $100/hour valuation. Replace
these assumptions with your own approved policies before using the report for business decisions.

```sh
ai-roi-scorecard init --db weekly.sqlite
ai-roi-scorecard policies import --db weekly.sqlite --input fixtures/cli/policies.json
ai-roi-scorecard ingest --db weekly.sqlite --account demo-account \
  --input fixtures/golden-otlp.input.json --input-format otlp
ai-roi-scorecard report --db weekly.sqlite --input fixtures/cli/report.json \
  --generated-at 2026-08-28T08:00:00.000Z --output weekly.json
ai-roi-scorecard render --input weekly.json --format text
ai-roi-scorecard render --input weekly.json --format html --output weekly.html
ai-roi-scorecard estimate --input fixtures/cli/estimate.json
```

The evidence-backed report estimates $75 of value. Replaying identical telemetry skips existing
events; a conflicting event ID fails without partial evidence writes. `estimate` produces an
explicitly illustrative scorecard.

| Command | Purpose |
| --- | --- |
| `init` | Safely initialize or reopen a SQLite ledger. |
| `ingest` | Validate, map, and ingest existing OTLP or JSON telemetry. |
| `policies import` | Store approved policies with immutable versions. |
| `report` | Generate and persist a snapshot from stored evidence and policies. |
| `estimate` | Explore explicitly illustrative assumptions. |
| `render` | Render a stored schema-v1 or schema-v2 snapshot as text or HTML. |

`report` and `estimate` default to canonical JSON and support `--format json|text|html` and
`--output FILE`. Use `--input -` for stdin. Results go to stdout or the output file;
diagnostics go to stderr. Exit codes are **0** for success (including an empty period),
**1** for operational failure, **2** for invalid arguments or data, and **3** for a report
requiring attention, with its output preserved.

See the [copyable CLI walkthrough](docs/cli.md) for generic JSON logs, optional attribute and
workflow mappings, and `--duration-mode span|omit`. SQLite is the CLI backend in this release;
PostgreSQL is supported through the SDK. Native vendor parsers remain
[waiting](docs/adapters-checklist.md).

## Estimated value and measured savings

Completed work can be valued against an approved baseline even when runtime is unavailable.
Schema v2 distinguishes `measured`, `partial`, and `not_provided` runtime, including per workflow:

- **Manual hours replaced** come from completed units and approved manual-time baselines.
- **Hours saved** subtract measured runtime and appear only when runtime is fully measured.
  Missing or partial runtime leaves total `timeSavedMs` as `null`; an explicit zero is measured.
- **Estimated dollar value** applies the approved hourly valuation. It is not a claim of realized
  cash savings. Illustrative estimates are labeled separately from evidence-backed reports.

New snapshots use schema v2. Existing schema-v1 snapshots remain readable with their historical
hashes preserved. See [calculation rules](docs/calculations.md) and
[schema migration](docs/migrations.md).

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

With the JavaScript package installed in your host application, embed a dashboard showing
**estimated dollars saved** and either **measured hours saved** or **manual hours replaced**
for the open reporting period:

```html
<script type="module">
  // Resolve this package import through your host application's bundler.
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
import { ingestOtlpJson } from "ai-roi-scorecard/adapters";

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
- AI time: supplied runtime, including failed retries. OTLP span duration is wall time; use
  `--duration-mode omit` when it cannot represent active worker time without queueing or waiting.
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
Publication and deployment remain pending as recorded in the
[living readiness checklist](docs/readiness-checklist.md). Snapshot schema changes follow
semantic versioning. The wire schema is versioned independently through `schemaVersion`
so stored reports remain readable.

## License

MIT
