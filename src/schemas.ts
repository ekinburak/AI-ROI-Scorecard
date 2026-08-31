import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;
export const RENDERER_VERSION = "1.0.0" as const;

export const DecimalIntegerStringSchema = z.string().regex(/^-?(0|[1-9]\d*)$/);
export const NonNegativeIntegerStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

const EventBaseFields = {
  eventId: z.string().min(1),
  accountId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  workflowKey: z.string().min(1),
  policyKey: z.string().min(1),
  occurredAt: IsoDateTimeSchema,
  sequence: NonNegativeIntegerStringSchema.optional(),
};

export const AttemptStartedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("attempt_started"),
});

export const AttemptFinishedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("attempt_finished"),
  status: z.enum(["succeeded", "failed", "cancelled", "abandoned"]),
  activeDurationMs: z.number().int().nonnegative(),
});

export const OutcomeCompletedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("outcome_completed"),
  outcomeId: z.string().min(1),
  units: z.number().int().positive().default(1),
});

export const ExceptionRecordedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("exception_recorded"),
  exceptionId: z.string().min(1),
  category: z.string().min(1),
  safeMessage: z.string().max(280).optional(),
});

export const ApprovalRequestedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("approval_requested"),
  approvalId: z.string().min(1),
  category: z.string().min(1),
});

export const ResolutionRecordedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("resolution_recorded"),
  exceptionId: z.string().min(1),
  resolution: z.string().min(1).max(280),
});

export const CorrectionAppendedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("correction_appended"),
  targetEventId: z.string().min(1),
  action: z.literal("void"),
  reason: z.string().min(1).max(280),
});

export const EvidenceEventSchema = z.discriminatedUnion("type", [
  AttemptStartedEventSchema,
  AttemptFinishedEventSchema,
  OutcomeCompletedEventSchema,
  ExceptionRecordedEventSchema,
  ApprovalRequestedEventSchema,
  ResolutionRecordedEventSchema,
  CorrectionAppendedEventSchema,
]);

export const LocalizedLabelSchema = z.object({
  default: z.string().min(1),
  translations: z.record(z.string(), z.string().min(1)).default({}),
});

export const ValuePolicySchema = z
  .object({
    policyKey: z.string().min(1),
    version: z.number().int().positive(),
    scope: z.enum(["default", "account"]),
    accountId: z.string().min(1).optional(),
    label: LocalizedLabelSchema,
    manualMinutesPerUnit: z.number().int().nonnegative(),
    evidenceLevel: z.enum(["measured", "approved_baseline"]),
    effectiveFrom: IsoDateTimeSchema,
    effectiveTo: IsoDateTimeSchema.nullish(),
  })
  .superRefine((policy, context) => {
    if (policy.scope === "account" && !policy.accountId) {
      context.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "accountId is required for account-scoped policies",
      });
    }
    if (policy.scope === "default" && policy.accountId) {
      context.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "accountId is not allowed for default policies",
      });
    }
    if (
      policy.effectiveTo &&
      Date.parse(policy.effectiveTo) <= Date.parse(policy.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be later than effectiveFrom",
      });
    }
  });

export const ValuationContextSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  currencyMinorUnitScale: z.number().int().min(0).max(4).default(2),
  hourlyValueMinor: NonNegativeIntegerStringSchema,
  serviceCostMinor: NonNegativeIntegerStringSchema.optional(),
});

export const ReportPeriodSchema = z
  .object({
    start: IsoDateTimeSchema,
    end: IsoDateTimeSchema,
  })
  .refine((period) => Date.parse(period.end) > Date.parse(period.start), {
    message: "period end must be later than start",
    path: ["end"],
  });

export const GenerationInputSchema = z.object({
  accountId: z.string().min(1),
  locale: z.string().min(2).default("en"),
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  evidenceWatermark: NonNegativeIntegerStringSchema.optional(),
  events: z.array(EvidenceEventSchema),
  policies: z.array(ValuePolicySchema),
  valuation: ValuationContextSchema,
});

export const EstimateWorkflowSchema = z.object({
  workflowKey: z.string().min(1),
  label: z.string().min(1),
  manualMinutes: z.number().int().nonnegative(),
  units: z.number().int().positive().default(1),
  aiDurationMs: z.number().int().nonnegative(),
});

export const EstimateInputSchema = z.object({
  accountId: z.string().min(1).default("illustrative"),
  locale: z.string().min(2).default("en"),
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  workflows: z.array(EstimateWorkflowSchema),
  valuation: ValuationContextSchema,
});

export const ScorecardLineItemSchema = z.object({
  workflowKey: z.string(),
  policyKey: z.string(),
  policyVersion: z.number().int().positive().nullable(),
  label: z.string(),
  units: z.number().int().nonnegative(),
  manualMinutes: NonNegativeIntegerStringSchema,
  aiDurationMs: NonNegativeIntegerStringSchema,
  estimatedValueMinor: NonNegativeIntegerStringSchema,
  evidenceLevel: z.enum(["measured", "approved_baseline", "illustrative"]),
});

export const ScorecardTotalsSchema = z.object({
  completedOutcomes: z.number().int().nonnegative(),
  manualMinutes: NonNegativeIntegerStringSchema,
  aiDurationMs: NonNegativeIntegerStringSchema,
  timeSavedMs: DecimalIntegerStringSchema,
  estimatedValueMinor: NonNegativeIntegerStringSchema,
  serviceCostMinor: NonNegativeIntegerStringSchema.optional(),
  netValueMinor: DecimalIntegerStringSchema.optional(),
  roiBasisPoints: DecimalIntegerStringSchema.optional(),
  valueToCostBasisPoints: NonNegativeIntegerStringSchema.optional(),
  exceptions: z.number().int().nonnegative(),
  unresolvedExceptions: z.number().int().nonnegative(),
  approvalsRequested: z.number().int().nonnegative(),
});

export const ScorecardSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  mode: z.enum(["audited", "illustrative"]),
  accountId: z.string(),
  locale: z.string(),
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  evidenceWatermark: NonNegativeIntegerStringSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  currencyMinorUnitScale: z.number().int().min(0).max(4),
  status: z.enum(["ready", "send_not_recommended", "needs_attention"]),
  lineItems: z.array(ScorecardLineItemSchema),
  totals: ScorecardTotalsSchema,
  evidenceIssues: z.array(z.string()),
  sourceFingerprint: z.string().length(64),
  snapshotHash: z.string().length(64),
});

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
export type AttemptStartedEvent = z.infer<typeof AttemptStartedEventSchema>;
export type AttemptFinishedEvent = z.infer<typeof AttemptFinishedEventSchema>;
export type OutcomeCompletedEvent = z.infer<typeof OutcomeCompletedEventSchema>;
export type ExceptionRecordedEvent = z.infer<typeof ExceptionRecordedEventSchema>;
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;
export type ResolutionRecordedEvent = z.infer<typeof ResolutionRecordedEventSchema>;
export type CorrectionAppendedEvent = z.infer<typeof CorrectionAppendedEventSchema>;
export type ValuePolicy = z.infer<typeof ValuePolicySchema>;
export type ValuationContext = z.infer<typeof ValuationContextSchema>;
export type ReportPeriod = z.infer<typeof ReportPeriodSchema>;
export type GenerationInput = z.input<typeof GenerationInputSchema>;
export type EstimateInput = z.input<typeof EstimateInputSchema>;
export type EstimateWorkflow = z.infer<typeof EstimateWorkflowSchema>;
export type ScorecardLineItem = z.infer<typeof ScorecardLineItemSchema>;
export type ScorecardTotals = z.infer<typeof ScorecardTotalsSchema>;
export type ScorecardSnapshot = z.infer<typeof ScorecardSnapshotSchema>;
