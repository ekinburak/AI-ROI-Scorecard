# Policy approval and governance

A policy is an approved business assumption, not telemetry. It contains:

- a stable `policyKey`;
- a positive version number;
- default or account scope;
- localized display labels;
- manual minutes per successful unit;
- evidence level; and
- effective start and optional retirement timestamps.

Account-scoped policies override defaults only for their account. Within the same scope, the most
recent effective policy and highest version win. Stored versions are immutable; publish a new
version and retire the old one instead of editing history.

Recommended approval workflow:

1. A process owner documents the manual baseline and evidence source.
2. An administrator reviews the label, unit definition, minutes, and effective date.
3. The host stores the approved version immutably.
4. Instrumented functions refer only to the stable `policyKey`.
5. Reports show which policy version valued each line.

Hourly value and service cost belong to the valuation context because they often change by account
or contract period. The SDK never guesses either number.
