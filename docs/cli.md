# CLI: existing telemetry to a weekly report

Version 0.2.0 provides the same `ai-roi-scorecard` command in npm and Python. Node requires
22.13 or newer; Python requires 3.11 or newer. Choose one installation:

```sh
npm install -g ai-roi-scorecard@0.2.0
# Or, in a Python virtual environment:
python -m pip install ai-roi-scorecard==0.2.0
python -m ai_roi_scorecard --version
```

Both packages consume camelCase JSON and produce identical snapshots and hashes for identical
inputs, including `generatedAt`. Installing both commands into the same directory may make one
shadow the other; the Python module command always selects Python.

## Copyable walkthrough

Run these commands from this repository's root. The shared [CLI fixtures](../fixtures/cli/)
contain example approved policy records, a report request, generic JSON logs, a mapping, and
an illustrative estimate. [The OTLP fixture](../fixtures/golden-otlp.input.json) describes the
same completed task. These are examples; replace the policies and hourly valuation with your
own approved assumptions before making business claims.

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

The fixture contains one completed ticket with an approved 45-minute baseline and a $100/hour
valuation. Its report estimates $75 of value; measured span duration is 1.2 seconds. All monetary
JSON fields use decimal strings in minor currency units. Replay the ingest command: it reports
`{"appended":0,"mapped":3,"skipped":3,"spans":1}` without changing the ledger.

For existing generic JSON logs, initialize another ledger and import the same policies, then:

```sh
ai-roi-scorecard init --db logs.sqlite
ai-roi-scorecard policies import --db logs.sqlite --input fixtures/cli/policies.json
ai-roi-scorecard ingest --db logs.sqlite --account demo-account \
  --input fixtures/cli/logs.json --input-format json \
  --mapping fixtures/cli/mapping.json --duration-mode omit
ai-roi-scorecard report --db logs.sqlite --input fixtures/cli/report.json \
  --generated-at 2026-08-28T08:00:00.000Z --format text
cat fixtures/cli/estimate.json | ai-roi-scorecard estimate --input -
```

Without runtime the report still estimates $75 and displays **Manual hours replaced**, with
`timeSavedMs: null`. `span` mode uses the supplied start/end duration; `omit` mode leaves runtime
unmeasured. Span wall time can include waiting; choose `omit` when it cannot represent active
worker time. Neither mode fills absent runtime with zero.

## Contracts

| Command | Inputs and behavior |
| --- | --- |
| `init --db FILE` | Repeated initialization preserves existing evidence, policies, and snapshots. |
| `ingest --db FILE --account ID --input FILE --input-format otlp\|json` | Validate, map, atomically append; stdout contains `spans`, `mapped`, `appended`, `skipped` counts. |
| `policies import --db FILE --input FILE` | Array of validated approved policy records. Existing immutable versions cannot be changed; identical imports are safe. |
| `report --db FILE --input FILE` | Request `{accountId,period,valuation,locale?}`. Capture ledger watermark, read through it, load stored policies, generate and persist snapshot. |
| `estimate --input FILE` | Estimate input with workflows and valuation; every snapshot explicitly says `illustrative`. |
| `render --input FILE --format text\|html` | Render an existing schema-v1 or schema-v2 snapshot without rewriting its historical hash. |

`report` and `estimate` default to canonical JSON; `--format json|text|html` and `--output FILE`
are supported. `render` defaults to text. Every input accepts `-` for stdin. Results are written
only to stdout or the specified output file; diagnostics go to stderr. JSON input is limited to
16 MiB, with the SDK's collection and scalar limits also enforced.

`report --generated-at ISO` overrides the current UTC timestamp. Pin it for deterministic reruns.
A new generation time or locale produces a new immutable snapshot fingerprint even at the same
watermark. Reports persist before presentation output is written; an unwritable output path
returns an operational error and leaves the generated snapshot in the ledger.

## Optional mapping file

```json
{
  "attributes": {"workflowKey":"task","policyKey":"baseline","outcomeId":"outcome","units":"count"},
  "workflowsByName": {"support-triage":{"workflowKey":"ticket-triage","policyKey":"ticket-triage"}}
}
```

Precedence is `roi.*` span tags, then mapped attribute names, then workflow/policy defaults by
span name. `roi.account_id` must match `--account`. Mapped completed work requires a real end
timestamp. Invalid dates and fractional, negative, zero, or oversized units are rejected.
Successful spans need an outcome ID to create a valued outcome. No mapped spans produces zero
counts and a diagnostic explaining how to add mapping.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Successful operation, including an empty reporting period (`send_not_recommended`). |
| 1 | Operational failure such as an inaccessible database or output path. |
| 2 | Invalid arguments or data, including conflicting evidence IDs and policy versions. |
| 3 | Generated or rendered report needs attention. Output is preserved for review. |

SQLite is the CLI storage backend in this release. PostgreSQL is available through the SDK.
Hosts own scheduling, authentication, delivery, and approval of value assumptions. See the
[living readiness checklist](readiness-checklist.md) for publication and deployment evidence.
