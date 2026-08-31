from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

SCHEMA_VERSION: Literal[1] = 1
RENDERER_VERSION = "1.0.0"


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


def _validate_iso_datetime(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("datetime must include a UTC offset")
    return value


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


IsoDateTime: TypeAlias = Annotated[str, AfterValidator(_validate_iso_datetime)]
DecimalIntegerString: TypeAlias = Annotated[str, StringConstraints(pattern=r"^-?(0|[1-9]\d*)$")]
NonNegativeIntegerString: TypeAlias = Annotated[
    str, StringConstraints(pattern=r"^(0|[1-9]\d*)$")
]


class Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        frozen=True,
        extra="forbid",
    )


class EventBase(Model):
    event_id: str = Field(min_length=1)
    account_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    attempt_id: str = Field(min_length=1)
    workflow_key: str = Field(min_length=1)
    policy_key: str = Field(min_length=1)
    occurred_at: IsoDateTime
    sequence: NonNegativeIntegerString | None = None


class AttemptStartedEvent(EventBase):
    type: Literal["attempt_started"] = "attempt_started"


class AttemptFinishedEvent(EventBase):
    type: Literal["attempt_finished"] = "attempt_finished"
    status: Literal["succeeded", "failed", "cancelled", "abandoned"]
    active_duration_ms: int = Field(ge=0)


class OutcomeCompletedEvent(EventBase):
    type: Literal["outcome_completed"] = "outcome_completed"
    outcome_id: str = Field(min_length=1)
    units: int = Field(default=1, gt=0)


class ExceptionRecordedEvent(EventBase):
    type: Literal["exception_recorded"] = "exception_recorded"
    exception_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    safe_message: str | None = Field(default=None, max_length=280)


class ApprovalRequestedEvent(EventBase):
    type: Literal["approval_requested"] = "approval_requested"
    approval_id: str = Field(min_length=1)
    category: str = Field(min_length=1)


class ResolutionRecordedEvent(EventBase):
    type: Literal["resolution_recorded"] = "resolution_recorded"
    exception_id: str = Field(min_length=1)
    resolution: str = Field(min_length=1, max_length=280)


class CorrectionAppendedEvent(EventBase):
    type: Literal["correction_appended"] = "correction_appended"
    target_event_id: str = Field(min_length=1)
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
    default: str = Field(min_length=1)
    translations: dict[str, str] = Field(default_factory=dict)


class ValuePolicy(Model):
    policy_key: str = Field(min_length=1)
    version: int = Field(gt=0)
    scope: Literal["default", "account"]
    account_id: str | None = Field(default=None, min_length=1)
    label: LocalizedLabel
    manual_minutes_per_unit: int = Field(ge=0)
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
    currency_minor_unit_scale: int = Field(default=2, ge=0, le=4)
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
    account_id: str = Field(min_length=1)
    locale: str = Field(default="en", min_length=2)
    period: ReportPeriod
    generated_at: IsoDateTime
    evidence_watermark: NonNegativeIntegerString | None = None
    events: list[EvidenceEvent]
    policies: list[ValuePolicy]
    valuation: ValuationContext


class EstimateWorkflow(Model):
    workflow_key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    manual_minutes: int = Field(ge=0)
    units: int = Field(default=1, gt=0)
    ai_duration_ms: int = Field(ge=0)


class EstimateInput(Model):
    account_id: str = Field(default="illustrative", min_length=1)
    locale: str = Field(default="en", min_length=2)
    period: ReportPeriod
    generated_at: IsoDateTime
    workflows: list[EstimateWorkflow]
    valuation: ValuationContext


class ScorecardLineItem(Model):
    workflow_key: str
    policy_key: str
    policy_version: int | None
    label: str
    units: int = Field(ge=0)
    manual_minutes: NonNegativeIntegerString
    ai_duration_ms: NonNegativeIntegerString
    estimated_value_minor: NonNegativeIntegerString
    evidence_level: Literal["measured", "approved_baseline", "illustrative"]


class ScorecardTotals(Model):
    completed_outcomes: int = Field(ge=0)
    manual_minutes: NonNegativeIntegerString
    ai_duration_ms: NonNegativeIntegerString
    time_saved_ms: DecimalIntegerString
    estimated_value_minor: NonNegativeIntegerString
    service_cost_minor: NonNegativeIntegerString | None = None
    net_value_minor: DecimalIntegerString | None = None
    roi_basis_points: DecimalIntegerString | None = None
    value_to_cost_basis_points: NonNegativeIntegerString | None = None
    exceptions: int = Field(ge=0)
    unresolved_exceptions: int = Field(ge=0)
    approvals_requested: int = Field(ge=0)


class ScorecardSnapshot(Model):
    schema_version: Literal[1] = SCHEMA_VERSION
    mode: Literal["audited", "illustrative"]
    account_id: str
    locale: str
    period: ReportPeriod
    generated_at: IsoDateTime
    evidence_watermark: NonNegativeIntegerString | None = None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
    currency_minor_unit_scale: int = Field(ge=0, le=4)
    status: Literal["ready", "send_not_recommended", "needs_attention"]
    line_items: list[ScorecardLineItem]
    totals: ScorecardTotals
    evidence_issues: list[str]
    source_fingerprint: Annotated[str, StringConstraints(min_length=64, max_length=64)]
    snapshot_hash: Annotated[str, StringConstraints(min_length=64, max_length=64)]
