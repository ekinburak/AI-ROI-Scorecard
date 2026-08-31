# Concepts and evidence lifecycle

An AI value scorecard connects three things that are often mixed together:

1. **Evidence** says what ran, what completed, how long active execution took, which exceptions
   occurred, and when a person was asked to approve something.
2. **Policy** says how much manual time one successful unit would normally require. Policy versions
   have effective dates and may be overridden for one account.
3. **Valuation** says what one manual hour is worth and, optionally, what the service cost during
   the same report period.

## Evidence lifecycle

Each worker invocation receives one durable attempt identity before work starts. A logical run may
have several attempts when the host retries it.

```text
attempt_started
  ├─ attempt_finished: succeeded → outcome_completed
  ├─ attempt_finished: failed → exception_recorded
  ├─ attempt_finished: cancelled or abandoned → exception_recorded
  └─ approval_requested

exception_recorded → resolution_recorded
any prior event → correction_appended: void
```

An outcome is valued once by its `outcomeId`. Retry attempts add active runtime and exceptions but
do not create additional value unless the host records a genuinely separate outcome.

## Watermarks and immutability

Storage adapters assign commit-ordered sequence numbers per account. Generation reads evidence
through a stable watermark. The resulting source fingerprint makes repeat generation idempotent;
the snapshot hash makes later mutation detectable.

Corrections append a new event that voids a prior event. Nothing edits or deletes history.

## Report statuses

- `ready`: completed, valued work has complete runtime and policy evidence.
- `send_not_recommended`: no valued work completed in the period.
- `needs_attention`: a successful outcome lacks measured completion evidence, a started attempt
  never finished, or an effective value policy is missing.

The SDK reports status. The host decides who may approve or deliver a report.
