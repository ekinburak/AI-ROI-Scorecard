# Instrumentation

Instrumentation records execution facts. It does not decide value.

## TypeScript

```ts
import { instrumentAsync } from "ai-roi-scorecard";

const { result } = await instrumentAsync(
  {
    accountId: "team-42",
    workflowKey: "ticket-triage",
    policyKey: "ticket-triage",
    sink: evidenceRepository,
  },
  () => classifyTicket(ticket),
  { runId: durableRunId, outcomeId: ticket.id },
);
```

Use `instrumentSync` for synchronous work. Both functions measure with a monotonic clock and
record timestamps separately with a wall clock.

## Python

```python
from ai_roi_scorecard import InstrumentationConfig, track_workflow

config = InstrumentationConfig(
    account_id="team-42",
    workflow_key="ticket-triage",
    policy_key="ticket-triage",
    sink=evidence_repository,
)

@track_workflow(config)
async def classify_ticket(ticket):
    return await classifier.run(ticket)
```

`instrument_sync`, `instrument_async`, and `workflow_attempt` are available when a decorator is
not a good fit.

## Durable identities

Generate an attempt identity while claiming work, then pass it into the instrumentor. Reuse one
`runId` for internal retries but create one `attemptId` per worker invocation. Supply a stable
`outcomeId` derived from the host's durable work unit.

If the sink cannot durably record evidence, instrumentation raises. Silently losing evidence
would make the scorecard appear more certain than it is.

Error classification is intentionally safe by default: the error class is recorded, not its raw
message. Hosts may provide an allowlisted safe message through `classifyError`.

## Already have observability?

If your product already emits OpenTelemetry spans or JSON logs (Langfuse, Datadog, PostHog, etc.),
you do not need to replace that pipeline with `instrumentAsync`. Use
[Telemetry adapters](adapters.md) to translate existing telemetry into the same evidence events
this page describes. Native instrumentation and adapters can coexist in one ledger.
