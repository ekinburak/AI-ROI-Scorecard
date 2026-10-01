from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from functools import cmp_to_key
from typing import Any

from .canonical import sha256_canonical, wire_value
from .models import (
    AttemptFinishedEvent,
    AttemptStartedEvent,
    CorrectionAppendedEvent,
    EstimateInput,
    ExceptionRecordedEvent,
    GenerationInput,
    OutcomeCompletedEvent,
    ResolutionRecordedEvent,
    ScorecardLineItem,
    ScorecardSnapshot,
    ScorecardTotals,
    ValuePolicy,
)


def round_half_up(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    sign = -1 if numerator < 0 else 1
    return sign * ((abs(numerator) + denominator // 2) // denominator)


def _dump(value: Any) -> Any:
    return wire_value(value)


def _instant(value: str) -> datetime:
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return instant.replace(microsecond=(instant.microsecond // 1000) * 1000)


def _compare_events(left: Any, right: Any) -> int:
    if left.sequence is not None and right.sequence is not None:
        difference = int(left.sequence) - int(right.sequence)
        if difference:
            return -1 if difference < 0 else 1
    if _instant(left.occurred_at) != _instant(right.occurred_at):
        return -1 if _instant(left.occurred_at) < _instant(right.occurred_at) else 1
    if left.event_id == right.event_id:
        return 0
    return -1 if left.event_id < right.event_id else 1


def _selected_policy(
    policies: list[ValuePolicy], account_id: str, occurred_at: str
) -> ValuePolicy | None:
    return next(
        (
            policy
            for policy in policies
            if _instant(policy.effective_from) <= _instant(occurred_at)
            and (
                policy.effective_to is None
                or _instant(occurred_at) < _instant(policy.effective_to)
            )
            and (policy.scope == "default" or policy.account_id == account_id)
        ),
        None,
    )


def _localized_label(policy: ValuePolicy, locale: str) -> str:
    return policy.label.translations.get(locale, policy.label.default)


def _cost_metrics(estimated_value: int, service_cost_minor: str | None) -> dict[str, str]:
    if service_cost_minor is None or int(service_cost_minor) == 0:
        return {}
    cost = int(service_cost_minor)
    net = estimated_value - cost
    return {
        "service_cost_minor": service_cost_minor,
        "net_value_minor": str(net),
        "roi_basis_points": str(round_half_up(net * 10_000, cost)),
        "value_to_cost_basis_points": str(round_half_up(estimated_value * 10_000, cost)),
    }


def _with_hash(payload: dict[str, Any]) -> ScorecardSnapshot:
    alias_payload = {
        key: _dump(value)
        if not isinstance(value, list)
        else [_dump(entry) for entry in value]
        for key, value in payload.items()
    }
    wire_payload = _dump(
        ScorecardSnapshot.model_validate({**alias_payload, "snapshot_hash": "0" * 64})
    )
    wire_payload.pop("snapshotHash")
    return ScorecardSnapshot.model_validate(
        {**alias_payload, "snapshot_hash": sha256_canonical(wire_payload)}
    )


def generate_scorecard(input_value: GenerationInput | dict[str, Any]) -> ScorecardSnapshot:
    parsed = (
        input_value
        if isinstance(input_value, GenerationInput)
        else GenerationInput.model_validate(input_value)
    )
    sorted_events = sorted(parsed.events, key=cmp_to_key(_compare_events))
    evidence_issues: list[str] = []
    unique_events_by_id: dict[str, Any] = {}
    for event in sorted_events:
        if _instant(event.occurred_at) > _instant(parsed.generated_at):
            evidence_issues.append(
                f"Event {event.event_id} occurred after snapshot generation."
            )
            continue
        existing = unique_events_by_id.get(event.event_id)
        if existing is None:
            unique_events_by_id[event.event_id] = event
        elif _dump(existing) != _dump(event):
            evidence_issues.append(f"Event {event.event_id} has conflicting payloads.")
    unique_events = list(unique_events_by_id.values())
    voided_event_ids: set[str] = set()
    for event in unique_events:
        if not isinstance(event, CorrectionAppendedEvent):
            continue
        target = unique_events_by_id.get(event.target_event_id)
        if target is None or isinstance(target, CorrectionAppendedEvent):
            evidence_issues.append(f"Correction {event.event_id} targets invalid evidence.")
        else:
            voided_event_ids.add(event.target_event_id)
    active_events = [event for event in unique_events if event.event_id not in voided_event_ids]
    period_events = [
        event
        for event in active_events
        if _instant(parsed.period.start) <= _instant(event.occurred_at) < _instant(parsed.period.end)
    ]
    starts = [event for event in active_events if isinstance(event, AttemptStartedEvent)]
    finishes = [event for event in active_events if isinstance(event, AttemptFinishedEvent)]
    outcomes = [event for event in period_events if isinstance(event, OutcomeCompletedEvent)]
    exception_events = [
        event for event in period_events if isinstance(event, ExceptionRecordedEvent)
    ]
    start_count_by_attempt_id: defaultdict[str, int] = defaultdict(int)
    finish_count_by_attempt_id: defaultdict[str, int] = defaultdict(int)
    outcome_count_by_attempt_id: defaultdict[str, int] = defaultdict(int)
    successful_finish_count_by_identity: defaultdict[tuple[str, str, str], int] = defaultdict(int)
    exception_attempt_ids = {event.attempt_id for event in exception_events}
    for start in starts:
        start_count_by_attempt_id[start.attempt_id] += 1
    for finish in finishes:
        finish_count_by_attempt_id[finish.attempt_id] += 1
        if finish.status == "succeeded":
            successful_finish_count_by_identity[
                (finish.attempt_id, finish.workflow_key, finish.policy_key)
            ] += 1
    unique_outcomes: list[OutcomeCompletedEvent] = []
    outcome_count_by_id: defaultdict[str, int] = defaultdict(int)
    for outcome in outcomes:
        outcome_count_by_attempt_id[outcome.attempt_id] += 1
        outcome_count_by_id[outcome.outcome_id] += 1
        if outcome_count_by_id[outcome.outcome_id] == 1:
            unique_outcomes.append(outcome)
    for outcome_id, count in outcome_count_by_id.items():
        if count > 1:
            evidence_issues.append(f"Outcome {outcome_id} was recorded more than once.")

    period_starts = [event for event in period_events if isinstance(event, AttemptStartedEvent)]
    period_finishes = [event for event in period_events if isinstance(event, AttemptFinishedEvent)]
    for start in period_starts:
        finish_count = finish_count_by_attempt_id[start.attempt_id]
        if finish_count == 0:
            evidence_issues.append(f"Attempt {start.attempt_id} has no finish event.")
        if finish_count > 1:
            evidence_issues.append(f"Attempt {start.attempt_id} has multiple finish events.")
    for finish in period_finishes:
        start_count = start_count_by_attempt_id[finish.attempt_id]
        if start_count == 0:
            evidence_issues.append(f"Attempt {finish.attempt_id} has no start event.")
        if start_count > 1:
            evidence_issues.append(f"Attempt {finish.attempt_id} has multiple start events.")
        if finish.status == "succeeded" and outcome_count_by_attempt_id[finish.attempt_id] != 1:
            evidence_issues.append(
                f"Successful attempt {finish.attempt_id} must have one completed outcome."
            )
        if finish.status != "succeeded" and finish.attempt_id not in exception_attempt_ids:
            evidence_issues.append(
                f"Unsuccessful attempt {finish.attempt_id} has no exception evidence."
            )
    complete_attempts = (
        all(finish_count_by_attempt_id[start.attempt_id] == 1 for start in period_starts)
        and all(start_count_by_attempt_id[finish.attempt_id] == 1 for finish in period_finishes)
    )
    measured_finishes = [event for event in period_finishes if event.active_duration_ms is not None]
    runtime_measurement = "not_provided" if not measured_finishes else "measured" if complete_attempts and len(measured_finishes) == len(period_finishes) else "partial"

    line_map: dict[str, dict[str, Any]] = {}
    policies_by_key: defaultdict[str, list[ValuePolicy]] = defaultdict(list)
    for candidate_policy in parsed.policies:
        policies_by_key[candidate_policy.policy_key].append(candidate_policy)
    for candidates in policies_by_key.values():
        candidates.sort(
            key=lambda policy: (
                policy.scope == "account",
                _instant(policy.effective_from),
                policy.version,
            ),
            reverse=True,
        )
    for outcome in unique_outcomes:
        finish_identity = (outcome.attempt_id, outcome.workflow_key, outcome.policy_key)
        if successful_finish_count_by_identity[finish_identity] != 1:
            evidence_issues.append(
                f"Outcome {outcome.outcome_id} has no successful completed attempt."
            )
            continue
        policy = _selected_policy(
            policies_by_key[outcome.policy_key], parsed.account_id, outcome.occurred_at
        )
        if policy is None:
            evidence_issues.append(f"No effective value policy exists for {outcome.policy_key}.")
            continue
        manual_minutes = policy.manual_minutes_per_unit * outcome.units
        estimated_value = round_half_up(
            manual_minutes * int(parsed.valuation.hourly_value_minor), 60
        )
        key = f"{outcome.workflow_key}\0{policy.policy_key}\0{policy.version}"
        existing = line_map.get(key)
        if existing:
            existing["units"] += outcome.units
            existing["manual_minutes"] += manual_minutes
            existing["estimated_value_minor"] += estimated_value
        else:
            line_map[key] = {
                "workflow_key": outcome.workflow_key,
                "policy_key": policy.policy_key,
                "policy_version": policy.version,
                "label": _localized_label(policy, parsed.locale),
                "units": outcome.units,
                "manual_minutes": manual_minutes,
                "ai_duration_ms": 0,
                "runtime_measurement": "measured",
                "value_group_key": None,
                "value_group_label": None,
                "hourly_value_minor": parsed.valuation.hourly_value_minor,
                "estimated_value_minor": estimated_value,
                "evidence_level": policy.evidence_level,
            }

    runtime_by_line: defaultdict[tuple[str, str], int] = defaultdict(int)
    ai_duration_ms = 0
    for event in period_events:
        if isinstance(event, AttemptFinishedEvent):
            ai_duration_ms += event.active_duration_ms or 0
            runtime_by_line[(event.workflow_key, event.policy_key)] += event.active_duration_ms or 0
    runtime_state_by_line: dict[tuple[str, str], list[int | bool]] = {}
    for runtime_event in [*period_starts, *period_finishes]:
        runtime_key = (runtime_event.workflow_key, runtime_event.policy_key)
        state = runtime_state_by_line.setdefault(runtime_key, [0, 0, True])
        if isinstance(runtime_event, AttemptFinishedEvent):
            state[0] += 1
            state[1] += runtime_event.active_duration_ms is not None
            state[2] = state[2] and start_count_by_attempt_id[runtime_event.attempt_id] == 1
        else:
            state[2] = state[2] and finish_count_by_attempt_id[runtime_event.attempt_id] == 1
    for line in line_map.values():
        runtime_key = (line["workflow_key"], line["policy_key"])
        line["ai_duration_ms"] = runtime_by_line[runtime_key]
        count, measured, complete = runtime_state_by_line.get(runtime_key, [0, 0, True])
        line["runtime_measurement"] = "not_provided" if measured == 0 else "measured" if complete and measured == count else "partial"

    line_items = [
        ScorecardLineItem.model_validate(
            {
                **line,
                "manual_minutes": str(line["manual_minutes"]),
                "ai_duration_ms": str(line["ai_duration_ms"]),
                "estimated_value_minor": str(line["estimated_value_minor"]),
            }
        )
        for _, line in sorted(line_map.items())
    ]
    manual_minutes = sum(int(line.manual_minutes) for line in line_items)
    estimated_value = sum(int(line.estimated_value_minor) for line in line_items)
    all_exception_ids = {
        event.exception_id
        for event in active_events
        if isinstance(event, ExceptionRecordedEvent)
    }
    resolutions = [
        event for event in active_events if isinstance(event, ResolutionRecordedEvent)
    ]
    resolution_count_by_exception_id: defaultdict[str, int] = defaultdict(int)
    for resolution in resolutions:
        resolution_count_by_exception_id[resolution.exception_id] += 1
    for resolution in resolutions:
        if resolution.exception_id not in all_exception_ids:
            evidence_issues.append(
                f"Resolution {resolution.event_id} has no recorded exception."
            )
        if resolution_count_by_exception_id[resolution.exception_id] > 1:
            evidence_issues.append(
                f"Exception {resolution.exception_id} has multiple resolutions."
            )
    resolved_exception_ids = {
        event.exception_id for event in resolutions
    }
    unresolved_exceptions = sum(
        event.exception_id not in resolved_exception_ids for event in exception_events
    )
    approvals_requested = sum(event.type == "approval_requested" for event in period_events)
    completed_outcomes = sum(line.units for line in line_items)
    status = (
        "needs_attention"
        if evidence_issues
        else "send_not_recommended"
        if completed_outcomes == 0
        else "ready"
    )
    evidence_watermark = parsed.evidence_watermark
    if evidence_watermark is None:
        sequences = [int(event.sequence) for event in sorted_events if event.sequence is not None]
        evidence_watermark = str(max(sequences)) if sequences else None
    source_fingerprint = sha256_canonical(
        {
            "schemaVersion": 2,
            "locale": parsed.locale,
            "generatedAt": parsed.generated_at,
            "accountId": parsed.account_id,
            "events": [_dump(event) for event in sorted_events],
            **(
                {"evidenceWatermark": evidence_watermark}
                if evidence_watermark is not None
                else {}
            ),
            "period": _dump(parsed.period),
            "policies": [
                _dump(policy)
                for policy in sorted(
                    parsed.policies,
                    key=lambda policy: (
                        policy.policy_key,
                        policy.scope,
                        policy.account_id or "",
                        policy.version,
                    ),
                )
            ],
            "valuation": _dump(parsed.valuation),
        }
    )
    totals_data: dict[str, Any] = {
        "completed_outcomes": completed_outcomes,
        "manual_minutes": str(manual_minutes),
        "ai_duration_ms": str(ai_duration_ms),
        "time_saved_ms": str(manual_minutes * 60_000 - ai_duration_ms) if runtime_measurement == "measured" else None,
        "estimated_value_minor": str(estimated_value),
        **_cost_metrics(estimated_value, parsed.valuation.service_cost_minor),
        "exceptions": len(exception_events),
        "unresolved_exceptions": unresolved_exceptions,
        "approvals_requested": approvals_requested,
    }
    return _with_hash(
        {
            "schema_version": 2,
            "mode": "audited",
            "account_id": parsed.account_id,
            "locale": parsed.locale,
            "period": parsed.period,
            "generated_at": parsed.generated_at,
            "evidence_watermark": evidence_watermark,
            "currency": parsed.valuation.currency,
            "currency_minor_unit_scale": parsed.valuation.currency_minor_unit_scale,
            "runtime_measurement": runtime_measurement,
            "status": status,
            "line_items": line_items,
            "totals": ScorecardTotals.model_validate(totals_data),
            "evidence_issues": sorted(set(evidence_issues)),
            "source_fingerprint": source_fingerprint,
        }
    )


def estimate_scorecard(input_value: EstimateInput | dict[str, Any]) -> ScorecardSnapshot:
    parsed = (
        input_value if isinstance(input_value, EstimateInput) else EstimateInput.model_validate(input_value)
    )
    line_items = []
    for workflow in parsed.workflows:
        manual_minutes = workflow.manual_minutes * workflow.units
        hourly_value_minor = (
            workflow.hourly_value_minor or parsed.valuation.hourly_value_minor
        )
        line_items.append(
            ScorecardLineItem(
                workflow_key=workflow.workflow_key,
                policy_key=workflow.workflow_key,
                policy_version=None,
                label=workflow.label,
                units=workflow.units,
                manual_minutes=str(manual_minutes),
                ai_duration_ms=str(workflow.ai_duration_ms or 0),
                runtime_measurement=(
                    "not_provided" if workflow.ai_duration_ms is None else "measured"
                ),
                value_group_key=workflow.value_group_key,
                value_group_label=workflow.value_group_label,
                hourly_value_minor=hourly_value_minor,
                estimated_value_minor=str(
                    round_half_up(
                        manual_minutes * int(hourly_value_minor), 60
                    )
                ),
                evidence_level="illustrative",
            )
        )
    manual_minutes = sum(int(line.manual_minutes) for line in line_items)
    ai_duration_ms = sum(int(line.ai_duration_ms) for line in line_items)
    estimated_value = sum(int(line.estimated_value_minor) for line in line_items)
    completed_outcomes = sum(line.units for line in line_items)
    measured_runtime_count = sum(
        workflow.ai_duration_ms is not None for workflow in parsed.workflows
    )
    if parsed.workflows and measured_runtime_count == len(parsed.workflows):
        runtime_measurement = "measured"
    elif measured_runtime_count == 0:
        runtime_measurement = "not_provided"
    else:
        runtime_measurement = "partial"
    source_fingerprint = sha256_canonical(
        {
            "schemaVersion": 2,
            "locale": parsed.locale,
            "generatedAt": parsed.generated_at,
            "accountId": parsed.account_id,
            "mode": "illustrative",
            "period": _dump(parsed.period),
            "valuation": _dump(parsed.valuation),
            "workflows": [_dump(workflow) for workflow in parsed.workflows],
        }
    )
    totals = ScorecardTotals.model_validate(
        {
            "completed_outcomes": completed_outcomes,
            "manual_minutes": str(manual_minutes),
            "ai_duration_ms": str(ai_duration_ms),
            "time_saved_ms": str(manual_minutes * 60_000 - ai_duration_ms) if runtime_measurement == "measured" else None,
            "estimated_value_minor": str(estimated_value),
            **_cost_metrics(estimated_value, parsed.valuation.service_cost_minor),
            "exceptions": 0,
            "unresolved_exceptions": 0,
            "approvals_requested": 0,
        }
    )
    return _with_hash(
        {
            "schema_version": 2,
            "mode": "illustrative",
            "account_id": parsed.account_id,
            "locale": parsed.locale,
            "period": parsed.period,
            "generated_at": parsed.generated_at,
            "currency": parsed.valuation.currency,
            "currency_minor_unit_scale": parsed.valuation.currency_minor_unit_scale,
            "runtime_measurement": runtime_measurement,
            "status": "send_not_recommended" if completed_outcomes == 0 else "ready",
            "line_items": line_items,
            "totals": totals,
            "evidence_issues": [],
            "source_fingerprint": source_fingerprint,
        }
    )
