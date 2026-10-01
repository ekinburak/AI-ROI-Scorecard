from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

SCHEMA_VERSION: Literal[2] = 2
RENDERER_VERSION = "2.0.0"
MAX_GENERATION_EVENTS = 10_000
MAX_GENERATION_POLICIES = 1_000
MAX_ESTIMATE_WORKFLOWS = 1_000
MAX_TRANSLATIONS = 32
MAX_IDENTIFIER_LENGTH = 256
MAX_LABEL_LENGTH = 512
MAX_LOCALE_LENGTH = 64
MAX_INTEGER_STRING_LENGTH = 128
MAX_DERIVED_INTEGER_STRING_LENGTH = 160
MAX_INPUT_INTEGER = 1_000_000_000
MAX_EVIDENCE_ISSUES = 120_000
MAX_EVIDENCE_ISSUE_LENGTH = 1_024


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


def _validate_iso_datetime(value: str) -> str:
    if len(value) > 64 or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])", value) is None:
        raise ValueError("Invalid ISO timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("datetime must include a UTC offset")
    return value


def _instant(value: str) -> datetime:
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return instant.replace(microsecond=(instant.microsecond // 1000) * 1000)


def _elapsed_ms(start: str, end: str) -> int:
    delta = _instant(end) - _instant(start)
    return delta.days * 86_400_000 + delta.seconds * 1000 + delta.microseconds // 1000


def _validate_json_integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not math.isfinite(value)) or value != int(value):
        raise ValueError("Expected an integer JSON number")
    return int(value)


JsonInteger: TypeAlias = Annotated[int, BeforeValidator(_validate_json_integer)]


Identifier: TypeAlias = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_IDENTIFIER_LENGTH)
]
Label: TypeAlias = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_LABEL_LENGTH)
]
Locale: TypeAlias = Annotated[
    str, StringConstraints(min_length=2, max_length=MAX_LOCALE_LENGTH)
]
IsoDateTime: TypeAlias = Annotated[
    str, StringConstraints(max_length=64), AfterValidator(_validate_iso_datetime)
]
DecimalIntegerString: TypeAlias = Annotated[
    str,
    StringConstraints(max_length=MAX_INTEGER_STRING_LENGTH + 1, pattern=r"^-?(0|[1-9][0-9]*)$"),
]
NonNegativeIntegerString: TypeAlias = Annotated[
    str,
    StringConstraints(max_length=MAX_INTEGER_STRING_LENGTH, pattern=r"^(0|[1-9][0-9]*)$"),
]
DerivedDecimalIntegerString: TypeAlias = Annotated[
    str,
    StringConstraints(
        max_length=MAX_DERIVED_INTEGER_STRING_LENGTH + 1,
        pattern=r"^-?(0|[1-9][0-9]*)$",
    ),
]
DerivedNonNegativeIntegerString: TypeAlias = Annotated[
    str,
    StringConstraints(
        max_length=MAX_DERIVED_INTEGER_STRING_LENGTH,
        pattern=r"^(0|[1-9][0-9]*)$",
    ),
]


class Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        frozen=True,
        extra="forbid",
    )


class EventBase(Model):
    event_id: Identifier
    account_id: Identifier
    run_id: Identifier
    attempt_id: Identifier
    workflow_key: Identifier
    policy_key: Identifier
    occurred_at: IsoDateTime
    sequence: NonNegativeIntegerString | None = None


class AttemptStartedEvent(EventBase):
    type: Literal["attempt_started"] = "attempt_started"


class AttemptFinishedEvent(EventBase):
    type: Literal["attempt_finished"] = "attempt_finished"
    status: Literal["succeeded", "failed", "cancelled", "abandoned"]
    active_duration_ms: JsonInteger | None = Field(default=None, ge=0, le=MAX_INPUT_INTEGER)


class OutcomeCompletedEvent(EventBase):
    type: Literal["outcome_completed"] = "outcome_completed"
    outcome_id: Identifier
    units: JsonInteger = Field(default=1, gt=0, le=MAX_INPUT_INTEGER)


class ExceptionRecordedEvent(EventBase):
    type: Literal["exception_recorded"] = "exception_recorded"
    exception_id: Identifier
    category: Identifier
    safe_message: str | None = Field(default=None, max_length=280)


class ApprovalRequestedEvent(EventBase):
    type: Literal["approval_requested"] = "approval_requested"
    approval_id: Identifier
    category: Identifier


class ResolutionRecordedEvent(EventBase):
    type: Literal["resolution_recorded"] = "resolution_recorded"
    exception_id: Identifier
    resolution: str = Field(min_length=1, max_length=280)


class CorrectionAppendedEvent(EventBase):
    type: Literal["correction_appended"] = "correction_appended"
    target_event_id: Identifier
    action: Literal["void"] = "void"
    reason: str = Field(min_length=1, max_length=280)


EvidenceEvent: TypeAlias = Annotated[
    AttemptStartedEvent
    | AttemptFinishedEvent
    | OutcomeCompletedEvent
    | ExceptionRecordedEvent
    | ApprovalRequestedEvent
    | ResolutionRecordedEvent
    | CorrectionAppendedEvent,
    Field(discriminator="type"),
]


class LocalizedLabel(Model):
    default: Label
    translations: dict[Locale, Label] = Field(default_factory=dict, max_length=MAX_TRANSLATIONS)


class ValuePolicy(Model):
    policy_key: Identifier
    version: JsonInteger = Field(gt=0, le=MAX_INPUT_INTEGER)
    scope: Literal["default", "account"]
    account_id: Identifier | None = None
    label: LocalizedLabel
    manual_minutes_per_unit: JsonInteger = Field(ge=0, le=MAX_INPUT_INTEGER)
    evidence_level: Literal["measured", "approved_baseline"]
    effective_from: IsoDateTime
    effective_to: IsoDateTime | None = None

    @model_validator(mode="after")
    def validate_scope(self) -> ValuePolicy:
        if self.scope == "account" and not self.account_id:
            raise ValueError("account_id is required for account-scoped policies")
        if self.scope == "default" and self.account_id:
            raise ValueError("account_id is not allowed for default policies")
        if self.effective_to and _instant(self.effective_to) <= _instant(self.effective_from):
            raise ValueError("effective_to must be later than effective_from")
        return self


class ValuationContext(Model):
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
    currency_minor_unit_scale: JsonInteger = Field(default=2, ge=0, le=4)
    hourly_value_minor: NonNegativeIntegerString
    service_cost_minor: NonNegativeIntegerString | None = None


class ReportPeriod(Model):
    start: IsoDateTime
    end: IsoDateTime

    @model_validator(mode="after")
    def validate_period(self) -> ReportPeriod:
        if _instant(self.end) <= _instant(self.start):
            raise ValueError("period end must be later than start")
        return self


class GenerationInput(Model):
    account_id: Identifier
    locale: Locale = "en"
    period: ReportPeriod
    generated_at: IsoDateTime
    evidence_watermark: NonNegativeIntegerString | None = None
    events: list[EvidenceEvent] = Field(max_length=MAX_GENERATION_EVENTS)
    policies: list[ValuePolicy] = Field(max_length=MAX_GENERATION_POLICIES)
    valuation: ValuationContext


class EstimateWorkflow(Model):
    workflow_key: Identifier
    label: Label
    manual_minutes: JsonInteger = Field(ge=0, le=MAX_INPUT_INTEGER)
    units: JsonInteger = Field(default=1, gt=0, le=MAX_INPUT_INTEGER)
    ai_duration_ms: JsonInteger | None = Field(default=None, ge=0, le=MAX_INPUT_INTEGER)
    value_group_key: Identifier | None = None
    value_group_label: Label | None = None
    hourly_value_minor: NonNegativeIntegerString | None = None


class EstimateInput(Model):
    account_id: Identifier = "illustrative"
    locale: Locale = "en"
    period: ReportPeriod
    generated_at: IsoDateTime
    workflows: list[EstimateWorkflow] = Field(max_length=MAX_ESTIMATE_WORKFLOWS)
    valuation: ValuationContext


class ScorecardLineItem(Model):
    workflow_key: Identifier
    policy_key: Identifier
    policy_version: int | None
    label: Label
    units: JsonInteger = Field(ge=0)
    manual_minutes: DerivedNonNegativeIntegerString
    ai_duration_ms: DerivedNonNegativeIntegerString
    runtime_measurement: Literal["measured", "partial", "not_provided"]
    value_group_key: Identifier | None
    value_group_label: Label | None
    hourly_value_minor: NonNegativeIntegerString
    estimated_value_minor: DerivedNonNegativeIntegerString
    evidence_level: Literal["measured", "approved_baseline", "illustrative"]


class ScorecardTotals(Model):
    completed_outcomes: JsonInteger = Field(ge=0)
    manual_minutes: DerivedNonNegativeIntegerString
    ai_duration_ms: DerivedNonNegativeIntegerString
    time_saved_ms: DerivedDecimalIntegerString | None
    estimated_value_minor: DerivedNonNegativeIntegerString
    service_cost_minor: NonNegativeIntegerString | None = None
    net_value_minor: DerivedDecimalIntegerString | None = None
    roi_basis_points: DerivedDecimalIntegerString | None = None
    value_to_cost_basis_points: DerivedNonNegativeIntegerString | None = None
    exceptions: JsonInteger = Field(ge=0)
    unresolved_exceptions: JsonInteger = Field(ge=0)
    approvals_requested: JsonInteger = Field(ge=0)


class ScorecardSnapshot(Model):
    schema_version: Literal[1, 2] = SCHEMA_VERSION
    mode: Literal["audited", "illustrative"]
    account_id: Identifier
    locale: Locale
    period: ReportPeriod
    generated_at: IsoDateTime
    evidence_watermark: NonNegativeIntegerString | None = None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
    currency_minor_unit_scale: JsonInteger = Field(ge=0, le=4)
    runtime_measurement: Literal["measured", "partial", "not_provided"]
    status: Literal["ready", "send_not_recommended", "needs_attention"]
    line_items: list[ScorecardLineItem] = Field(max_length=MAX_GENERATION_EVENTS)
    totals: ScorecardTotals
    evidence_issues: list[
        Annotated[str, StringConstraints(max_length=MAX_EVIDENCE_ISSUE_LENGTH)]
    ] = Field(max_length=MAX_EVIDENCE_ISSUES)
    source_fingerprint: Annotated[str, StringConstraints(min_length=64, max_length=64)]
    snapshot_hash: Annotated[str, StringConstraints(min_length=64, max_length=64)]

    @model_validator(mode="after")
    def validate_runtime_version(self) -> ScorecardSnapshot:
        if self.schema_version == 1 and (self.totals.time_saved_ms is None or any(line.runtime_measurement == "partial" for line in self.line_items)):
            raise ValueError("Invalid legacy v1 snapshot")
        if self.schema_version == 2 and ((self.runtime_measurement == "measured") != (self.totals.time_saved_ms is not None)):
            raise ValueError("Time saved requires fully measured runtime")
        return self
