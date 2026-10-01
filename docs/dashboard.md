# Embeddable CFO dashboard

The dashboard shows a CFO **hours saved** and **dollars saved** for the current reporting period.
It consumes an immutable `ScorecardSnapshot` produced by `generateScorecard` or
`estimateScorecard`. The SDK does not authenticate users, poll your database, or decide when a week
closes. The host supplies snapshots as evidence arrives.

## Quick embed

```html
<script type="module">
  import { registerAiRoiDashboard } from "ai-roi-scorecard/dashboard";

  registerAiRoiDashboard();
  const element = document.querySelector("ai-roi-dashboard");
  element.snapshot = snapshotFromYourHost;
  element.dashboardOptions = { accountName: "Acme Corp", periodState: "open" };
</script>
<ai-roi-dashboard audience="cfo" period-state="open"></ai-roi-dashboard>
```

React hosts:

```tsx
import { AiRoiDashboard } from "ai-roi-scorecard/dashboard/react";

<AiRoiDashboard
  snapshot={snapshot}
  accountName="Acme Corp"
  periodState="open"
  audience="cfo"
/>;
```

## Live refresh pattern

Regenerate the open week from your evidence ledger whenever new outcomes arrive, then assign the
new snapshot to the element property:

```ts
import { generateScorecard } from "ai-roi-scorecard";

const snapshot = generateScorecard({
  accountId,
  period: openWeekPeriod,
  generatedAt: new Date().toISOString(),
  events: await repository.getEvents(accountId, { throughSequence: watermark }),
  policies: await repository.getPolicies(accountId),
  valuation: approvedValuation,
});

element.snapshot = snapshot;
```

For a **sealed** week that was already approved, load the stored snapshot by fingerprint and set
`periodState: "sealed"`. Do not regenerate for display of an approved report.

See [examples/dashboard/](examples/dashboard/) for a static host that simulates incoming work.

## CFO vs operator audience

| `audience` | Default surface |
| --- | --- |
| `cfo` | Hero hours and dollars, usage strip, workflow table, audit footer |
| `operator` | Same plus exceptions, approvals, and evidence issues |

Hours saved appears only when `runtimeMeasurement === "measured"`. Otherwise the hero shows
**Manual hours replaced** from approved baselines and never claims time saved without measured AI
runtime.

## Styling

The custom element uses Shadow DOM and CSS variables on `:host`:

- `--roi-dashboard-canvas`
- `--roi-dashboard-surface`
- `--roi-dashboard-primary`
- `--roi-dashboard-muted`
- `--roi-dashboard-accent`
- `--roi-dashboard-border`

Override these on `ai-roi-dashboard` in your layout to match your product chrome.

## Telemetry ingest contract

Existing tools (OpenTelemetry, Langfuse, Datadog, PostHog, etc.) can feed the same dashboard if a
host maps their events onto the evidence schema before calling `generateScorecard`. The dashboard
does not care whether evidence came from `instrumentAsync` or an adapter.

**Implementation guide:** [Telemetry adapters](adapters.md) — step-by-step parse, map, ingest, and
dashboard wiring for brownfield hosts.

### What telemetry can supply

| Source field | Evidence field |
| --- | --- |
| Span or event id | `eventId`, `attemptId` |
| Trace id | `runId` |
| Timestamps, duration | `occurredAt`, `activeDurationMs` on `attempt_finished` |
| Status | `succeeded`, `failed`, `cancelled`, `abandoned` |
| Custom tags | `workflowKey`, `accountId`, `outcomeId` |

### What telemetry cannot supply

- `manualMinutesPerUnit` (approved policy baselines)
- `hourlyValueMinor` and `serviceCostMinor` (valuation context)
- Proof that an HTTP 200 or LLM completion is a **completed business outcome**

Without policy and valuation, you have usage charts, not a CFO scorecard.

### Mapping rules

1. **Value a row:** `outcome_completed` with stable `outcomeId`, effective policy, and
   `attempt_finished` with `activeDurationMs` if hours saved should appear.
2. **Drop prompts and PII:** never copy prompts, completions, stack traces, or emails from the
   source tool. Use allowlisted exception categories only.
3. **Duration:** map active worker time, not queue wait or provider round-trip. If duration is
   unknown, omit runtime and accept `not_provided` rather than reporting zero.
4. **Idempotency:** reuse stable source ids (span id, analytics event id) so replays do not
   double-count value.

Shipped adapters live at `ai-roi-scorecard/adapters`. Native `instrumentAsync` / `track_workflow`
remain the recommended collector for greenfield work.

## Headless view model

Use `toDashboardViewModel` when you want your own UI but the same CFO labels and deltas:

```ts
import { toDashboardViewModel } from "ai-roi-scorecard";

const view = toDashboardViewModel(snapshot, {
  previousSnapshot: lastWeekSnapshot,
  periodState: "open",
  audience: "cfo",
});
```

Python: `to_dashboard_view_model(snapshot, DashboardOptions(...))`.
