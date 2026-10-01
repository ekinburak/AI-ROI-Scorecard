import { z } from "zod";

export const SCHEMA_VERSION = 2 as const;
export const RENDERER_VERSION = "2.0.0" as const;

export const MAX_GENERATION_EVENTS = 10_000;
export const MAX_GENERATION_POLICIES = 1_000;
export const MAX_ESTIMATE_WORKFLOWS = 1_000;
export const MAX_TRANSLATIONS = 32;
export const MAX_IDENTIFIER_LENGTH = 256;
export const MAX_LABEL_LENGTH = 512;
export const MAX_LOCALE_LENGTH = 64;
export const MAX_INTEGER_STRING_LENGTH = 128;
export const MAX_DERIVED_INTEGER_STRING_LENGTH = 160;
export const MAX_INPUT_INTEGER = 1_000_000_000;
export const MAX_EVIDENCE_ISSUES = 120_000;
export const MAX_EVIDENCE_ISSUE_LENGTH = 1_024;

const IdentifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const LabelSchema = z.string().min(1).max(MAX_LABEL_LENGTH);
const LocaleSchema = z.string().min(2).max(MAX_LOCALE_LENGTH);

export const DecimalIntegerStringSchema = z
  .string()
  .max(MAX_INTEGER_STRING_LENGTH + 1)
  .regex(/^-?(0|[1-9]\d*)$/);
export const NonNegativeIntegerStringSchema = z
  .string()
  .max(MAX_INTEGER_STRING_LENGTH)
  .regex(/^(0|[1-9]\d*)$/);
const DerivedDecimalIntegerStringSchema = z
  .string()
  .max(MAX_DERIVED_INTEGER_STRING_LENGTH + 1)
  .regex(/^-?(0|[1-9]\d*)$/);
const DerivedNonNegativeIntegerStringSchema = z
  .string()
  .max(MAX_DERIVED_INTEGER_STRING_LENGTH)
  .regex(/^(0|[1-9]\d*)$/);
export const IsoDateTimeSchema = z.string().max(64).datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)) && Number(value.slice(0, 4)) > 0, "Invalid timestamp");

const EventBaseFields = {
  eventId: IdentifierSchema,
  accountId: IdentifierSchema,
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  workflowKey: IdentifierSchema,
  policyKey: IdentifierSchema,
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
  activeDurationMs: z.number().int().nonnegative().max(MAX_INPUT_INTEGER).optional(),
});

export const OutcomeCompletedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("outcome_completed"),
  outcomeId: IdentifierSchema,
  units: z.number().int().positive().max(MAX_INPUT_INTEGER).default(1),
});

export const ExceptionRecordedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("exception_recorded"),
  exceptionId: IdentifierSchema,
  category: IdentifierSchema,
  safeMessage: z.string().max(280).optional(),
});

export const ApprovalRequestedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("approval_requested"),
  approvalId: IdentifierSchema,
  category: IdentifierSchema,
});

export const ResolutionRecordedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("resolution_recorded"),
  exceptionId: IdentifierSchema,
  resolution: z.string().min(1).max(280),
});

export const CorrectionAppendedEventSchema = z.object({
  ...EventBaseFields,
  type: z.literal("correction_appended"),
  targetEventId: IdentifierSchema,
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
  default: LabelSchema,
  translations: z
    .record(LocaleSchema, LabelSchema)
    .refine((translations) => Object.keys(translations).length <= MAX_TRANSLATIONS, {
      message: `No more than ${MAX_TRANSLATIONS} translations are allowed`,
    })
    .default({}),
});

export const ValuePolicySchema = z
  .object({
    policyKey: IdentifierSchema,
    version: z.number().int().positive().max(MAX_INPUT_INTEGER),
    scope: z.enum(["default", "account"]),
    accountId: IdentifierSchema.optional(),
    label: LocalizedLabelSchema,
    manualMinutesPerUnit: z.number().int().nonnegative().max(MAX_INPUT_INTEGER),
    evidenceLevel: z.enum(["measured", "approved_baseline"]),
    effectiveFrom: IsoDateTimeSchema,
    effectiveTo: IsoDateTimeSchema.nullish().transform((value) => value ?? undefined).optional(),
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
  accountId: IdentifierSchema,
  locale: LocaleSchema.default("en"),
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  evidenceWatermark: NonNegativeIntegerStringSchema.optional(),
  events: z.array(EvidenceEventSchema).max(MAX_GENERATION_EVENTS),
  policies: z.array(ValuePolicySchema).max(MAX_GENERATION_POLICIES),
  valuation: ValuationContextSchema,
});

export const EstimateWorkflowSchema = z.object({
  workflowKey: IdentifierSchema,
  label: LabelSchema,
  manualMinutes: z.number().int().nonnegative().max(MAX_INPUT_INTEGER),
  units: z.number().int().positive().max(MAX_INPUT_INTEGER).default(1),
  aiDurationMs: z.number().int().nonnegative().max(MAX_INPUT_INTEGER).optional(),
  valueGroupKey: IdentifierSchema.optional(),
  valueGroupLabel: LabelSchema.optional(),
  hourlyValueMinor: NonNegativeIntegerStringSchema.optional(),
});

export const EstimateInputSchema = z.object({
  accountId: IdentifierSchema.default("illustrative"),
  locale: LocaleSchema.default("en"),
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  workflows: z.array(EstimateWorkflowSchema).max(MAX_ESTIMATE_WORKFLOWS),
  valuation: ValuationContextSchema,
});

export const ScorecardLineItemSchema = z.object({
  workflowKey: IdentifierSchema,
  policyKey: IdentifierSchema,
  policyVersion: z.number().int().positive().nullable(),
  label: LabelSchema,
  units: z.number().int().nonnegative(),
  manualMinutes: DerivedNonNegativeIntegerStringSchema,
  aiDurationMs: DerivedNonNegativeIntegerStringSchema,
  runtimeMeasurement: z.enum(["measured", "partial", "not_provided"]),
  valueGroupKey: IdentifierSchema.nullable(),
  valueGroupLabel: LabelSchema.nullable(),
  hourlyValueMinor: NonNegativeIntegerStringSchema,
  estimatedValueMinor: DerivedNonNegativeIntegerStringSchema,
  evidenceLevel: z.enum(["measured", "approved_baseline", "illustrative"]),
});

export const ScorecardTotalsSchema = z.object({
  completedOutcomes: z.number().int().nonnegative(),
  manualMinutes: DerivedNonNegativeIntegerStringSchema,
  aiDurationMs: DerivedNonNegativeIntegerStringSchema,
  timeSavedMs: DerivedDecimalIntegerStringSchema.nullable(),
  estimatedValueMinor: DerivedNonNegativeIntegerStringSchema,
  serviceCostMinor: NonNegativeIntegerStringSchema.optional(),
  netValueMinor: DerivedDecimalIntegerStringSchema.optional(),
  roiBasisPoints: DerivedDecimalIntegerStringSchema.optional(),
  valueToCostBasisPoints: DerivedNonNegativeIntegerStringSchema.optional(),
  exceptions: z.number().int().nonnegative(),
  unresolvedExceptions: z.number().int().nonnegative(),
  approvalsRequested: z.number().int().nonnegative(),
});

export const ScorecardSnapshotSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(SCHEMA_VERSION)]),
  mode: z.enum(["audited", "illustrative"]),
  accountId: IdentifierSchema,
  locale: LocaleSchema,
  period: ReportPeriodSchema,
  generatedAt: IsoDateTimeSchema,
  evidenceWatermark: NonNegativeIntegerStringSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  currencyMinorUnitScale: z.number().int().min(0).max(4),
  runtimeMeasurement: z.enum(["measured", "partial", "not_provided"]),
  status: z.enum(["ready", "send_not_recommended", "needs_attention"]),
  lineItems: z.array(ScorecardLineItemSchema).max(MAX_GENERATION_EVENTS),
  totals: ScorecardTotalsSchema,
  evidenceIssues: z
    .array(z.string().max(MAX_EVIDENCE_ISSUE_LENGTH))
    .max(MAX_EVIDENCE_ISSUES),
  sourceFingerprint: z.string().length(64),
  snapshotHash: z.string().length(64),
}).superRefine((snapshot, context) => {
  if (snapshot.schemaVersion === 1 && (snapshot.totals.timeSavedMs === null || snapshot.lineItems.some((line) => line.runtimeMeasurement === "partial"))) {
    context.addIssue({ code: "custom", message: "Invalid legacy v1 snapshot" });
  }
  if (snapshot.schemaVersion === 2 && ((snapshot.runtimeMeasurement === "measured") !== (snapshot.totals.timeSavedMs !== null))) {
    context.addIssue({ code: "custom", message: "Time saved requires fully measured runtime" });
  }
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
