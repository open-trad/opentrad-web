import { boundedCompositeSchema } from "../../boundaries.js";
import {
  isolatedArraySchema,
  isolatedDiscriminatedUnionSchema,
  isolatedObjectSchema,
} from "../../safe-schema.js";
import { z } from "../../zod.js";
import type { EntityPartyV2 } from "../common.js";
import type { WatermarkPolicyV2 } from "../document-model.js";
import { MoneyMinorV2Schema } from "../money.js";
import type { AttachmentRefV1 } from "../project.js";
import { type RiskFindingV2, RiskFindingV2Schema } from "../risk.js";
import { PartyV2Schema } from "./quote-common.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BID_TEMPLATE_IDS = Object.freeze([
  "bid.government.goods.v1",
  "bid.government.services.v1",
  "bid.construction.works.v1",
  "bid.enterprise.goods.v1",
  "bid.enterprise.services.v1",
] as const);

interface SafeIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

function strictIsolatedObjectSchema<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssue) => void) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
          if (
            typeof key !== "string" ||
            !allowedKeys.has(key) ||
            DANGEROUS_KEYS.has(key) ||
            !descriptor ||
            !("value" in descriptor) ||
            descriptor.value === undefined
          ) {
            context.addIssue({
              code: "custom",
              message: "Unknown, dangerous, accessor, or undefined object field",
              path: typeof key === "string" ? [key] : [],
            });
          }
        }
      }
      if (context.issues.length > 0) return z.NEVER;
      const result = isolated.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      return result.data;
    } catch {
      context.addIssue({ code: "custom", message: "Object validation failed safely" });
      return z.NEVER;
    }
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("Validated output must contain only own data properties");
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

interface BoundaryPolicy {
  readonly arrayLimits?: Readonly<Record<string, number>>;
  readonly maxTotalValues?: number;
}

function frozenCompositeSchema<T extends z.ZodType>(schema: T, policy: BoundaryPolicy = {}) {
  const frozen = z.transform<unknown, z.output<T>>((input, context) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ ...issue });
      return z.NEVER;
    }
    return deepFreeze(result.data);
  });
  return boundedCompositeSchema(frozen, policy);
}

function safeText(maximumLength: number, required = false) {
  const htmlPattern = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine((value) => {
      for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
          const next = value.charCodeAt(index + 1);
          if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
          index += 1;
          continue;
        }
        if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
        if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
        if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
      }
      return true;
    }, "Text is not XML 1.0 safe")
    .refine((value) => !htmlPattern.test(value), "HTML is not allowed");
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isOffsetDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , zone, , offsetHour, offsetMinute] = match;
  if (
    !year ||
    !month ||
    !day ||
    !hour ||
    !minute ||
    !second ||
    !zone ||
    !isCalendarDate(`${year}-${month}-${day}`) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    return false;
  }
  if (
    zone !== "Z" &&
    (!offsetHour ||
      !offsetMinute ||
      Number(offsetHour) > 14 ||
      Number(offsetMinute) > 59 ||
      (Number(offsetHour) === 14 && Number(offsetMinute) !== 0))
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function uniqueIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: SafeIssue) => void,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({ code: "custom", message: `${label} ids must be unique`, path: [index, "id"] });
    }
    seen.add(value.id);
  });
}

function uniqueStrings(
  values: readonly string[],
  addIssue: (issue: SafeIssue) => void,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue({ code: "custom", message: `${label} must be unique`, path: [index] });
    }
    seen.add(value);
  });
}

const IdentifierRawSchema = safeText(64, true).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/,
  "Expected a stable identifier",
);
const SourceRefRawSchema = safeText(300, true);
const DateRawSchema = z.string().refine(isCalendarDate, "Expected a real YYYY-MM-DD date");
const BlankableDateRawSchema = z.union([z.literal(""), DateRawSchema]);
const OffsetDateTimeRawSchema = z
  .string()
  .refine(isOffsetDateTime, "Expected an ISO date-time with an explicit offset");
const BlankableOffsetDateTimeRawSchema = z.union([z.literal(""), OffsetDateTimeRawSchema]);

const ClarificationAttachmentRawSchema = strictIsolatedObjectSchema({
  clarificationId: safeText(100, true),
  attachmentId: IdentifierRawSchema,
});

export interface VersionEvidenceV1 {
  readonly mainSolicitationAttachmentId?: string;
  readonly clarificationAttachments: readonly {
    readonly clarificationId: string;
    readonly attachmentId: string;
  }[];
  readonly allClarificationsIncluded: boolean;
  readonly userConfirmedExactVersion: boolean;
}

const VersionEvidenceV1RawSchema = strictIsolatedObjectSchema(
  {
    mainSolicitationAttachmentId: IdentifierRawSchema.optional(),
    clarificationAttachments: isolatedArraySchema(ClarificationAttachmentRawSchema, { max: 100 }),
    allClarificationsIncluded: z.boolean(),
    userConfirmedExactVersion: z.boolean(),
  },
  (evidence, addIssue) =>
    uniqueStrings(
      evidence.clarificationAttachments.map((item) => item.clarificationId),
      addIssue,
      "Clarification evidence ids",
    ),
);
export const VersionEvidenceV1Schema = frozenCompositeSchema(VersionEvidenceV1RawSchema, {
  arrayLimits: { clarificationAttachments: 100 },
});

export interface BidGuaranteeRequirementV1 {
  readonly required: boolean;
  readonly allowedMethods: readonly string[];
  readonly amountMinor?: string;
  readonly sourceRefIds: readonly string[];
}

const BidGuaranteeRequirementV1RawSchema = strictIsolatedObjectSchema(
  {
    required: z.boolean(),
    allowedMethods: isolatedArraySchema(safeText(100, true), {
      max: 10,
      refine: (values, addIssue) => uniqueStrings(values, addIssue, "Guarantee methods"),
    }),
    amountMinor: MoneyMinorV2Schema.optional(),
    sourceRefIds: isolatedArraySchema(IdentifierRawSchema, {
      max: 100,
      refine: (values, addIssue) => uniqueStrings(values, addIssue, "Guarantee source refs"),
    }),
  },
  (requirement, addIssue) => {
    if (
      requirement.required &&
      (requirement.allowedMethods.length === 0 ||
        requirement.amountMinor === undefined ||
        requirement.sourceRefIds.length === 0)
    ) {
      addIssue({ code: "custom", message: "Required guarantee terms must be explicit" });
    }
    if (
      !requirement.required &&
      (requirement.allowedMethods.length > 0 ||
        requirement.amountMinor !== undefined ||
        requirement.sourceRefIds.length > 0)
    ) {
      addIssue({ code: "custom", message: "Non-required guarantee cannot carry required terms" });
    }
  },
);
export const BidGuaranteeRequirementV1Schema = frozenCompositeSchema(
  BidGuaranteeRequirementV1RawSchema,
  { arrayLimits: { allowedMethods: 10, sourceRefIds: 100 } },
);

const SubmissionCopiesV1RawSchema = strictIsolatedObjectSchema(
  {
    original: z.number().int().min(0).max(100),
    copies: z.number().int().min(0).max(100),
    electronic: z.number().int().min(0).max(100),
  },
  (copies, addIssue) => {
    if (copies.original + copies.copies + copies.electronic < 1) {
      addIssue({ code: "custom", message: "At least one submission copy is required" });
    }
  },
);

export interface SolicitationSnapshotV1 {
  readonly issuer: string;
  readonly agency?: string;
  readonly projectName: string;
  readonly projectNumber: string;
  readonly packageNumber?: string;
  readonly versionLabel: string;
  readonly issueDate: string;
  readonly clarificationIds: readonly string[];
  readonly versionEvidence: VersionEvidenceV1;
  readonly bidDeadline: string;
  readonly openingTime?: string;
  readonly openingPlace?: string;
  readonly bidValidityDays: number;
  readonly submissionMode: "paper" | "electronic" | "both";
  readonly signatureRules: string;
  readonly sealingRules?: string;
  readonly currency: "CNY" | "USD" | "EUR";
  readonly taxBasis: "tax-included" | "tax-excluded" | "tax-exempt" | "as-specified";
  readonly evaluationMethod:
    | "lowest-price"
    | "comprehensive-score"
    | "comprehensive-evaluation"
    | "other";
  readonly maximumPriceMinor?: string;
  readonly jointVentureAllowed: boolean;
  readonly subcontractAllowed: boolean;
  readonly submissionCopies: {
    readonly original: number;
    readonly copies: number;
    readonly electronic: number;
  };
  readonly guaranteeRequirement: BidGuaranteeRequirementV1;
}

const SolicitationSnapshotV1RawSchema = strictIsolatedObjectSchema(
  {
    issuer: safeText(300),
    agency: safeText(300, true).optional(),
    projectName: safeText(500),
    projectNumber: safeText(200),
    packageNumber: safeText(200, true).optional(),
    versionLabel: safeText(500),
    issueDate: BlankableDateRawSchema,
    clarificationIds: isolatedArraySchema(safeText(100, true), {
      max: 100,
      refine: (values, addIssue) => uniqueStrings(values, addIssue, "Clarification ids"),
    }),
    versionEvidence: VersionEvidenceV1RawSchema,
    bidDeadline: BlankableOffsetDateTimeRawSchema,
    openingTime: OffsetDateTimeRawSchema.optional(),
    openingPlace: safeText(500, true).optional(),
    bidValidityDays: z.number().int().min(1).max(3_650),
    submissionMode: z.enum(["paper", "electronic", "both"]),
    signatureRules: safeText(2_000),
    sealingRules: safeText(2_000, true).optional(),
    currency: z.enum(["CNY", "USD", "EUR"]),
    taxBasis: z.enum(["tax-included", "tax-excluded", "tax-exempt", "as-specified"]),
    evaluationMethod: z.enum([
      "lowest-price",
      "comprehensive-score",
      "comprehensive-evaluation",
      "other",
    ]),
    maximumPriceMinor: MoneyMinorV2Schema.optional(),
    jointVentureAllowed: z.boolean(),
    subcontractAllowed: z.boolean(),
    submissionCopies: SubmissionCopiesV1RawSchema,
    guaranteeRequirement: BidGuaranteeRequirementV1RawSchema,
  },
  (snapshot, addIssue) => {
    const clarificationIds = new Set(snapshot.clarificationIds);
    for (const [index, evidence] of snapshot.versionEvidence.clarificationAttachments.entries()) {
      if (!clarificationIds.has(evidence.clarificationId)) {
        addIssue({
          code: "custom",
          message: "Clarification attachment is not declared",
          path: ["versionEvidence", "clarificationAttachments", index, "clarificationId"],
        });
      }
    }
    if (
      snapshot.openingTime !== undefined &&
      snapshot.bidDeadline !== "" &&
      Date.parse(snapshot.openingTime) < Date.parse(snapshot.bidDeadline)
    ) {
      addIssue({
        code: "custom",
        message: "Opening time cannot precede the bid deadline",
        path: ["openingTime"],
      });
    }
  },
);
export const SolicitationSnapshotV1Schema = frozenCompositeSchema(SolicitationSnapshotV1RawSchema, {
  arrayLimits: {
    allowedMethods: 10,
    clarificationAttachments: 100,
    clarificationIds: 100,
    sourceRefIds: 100,
  },
});

export type EvidenceRefV1 =
  | {
      readonly id: string;
      readonly kind: "solicitation";
      readonly sourceRef: string;
      readonly attachmentId: string;
      readonly page: number;
    }
  | {
      readonly id: string;
      readonly kind: "proof";
      readonly attachmentId: string;
      readonly page: number;
      readonly label?: string;
    };

const SolicitationEvidenceRefV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  kind: z.literal("solicitation"),
  sourceRef: SourceRefRawSchema,
  attachmentId: IdentifierRawSchema,
  page: z.number().int().min(1).max(10_000),
});
const ProofEvidenceRefV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  kind: z.literal("proof"),
  attachmentId: IdentifierRawSchema,
  page: z.number().int().min(1).max(10_000),
  label: safeText(300, true).optional(),
});
const EvidenceRefV1RawSchema = isolatedDiscriminatedUnionSchema("kind", {
  solicitation: SolicitationEvidenceRefV1RawSchema,
  proof: ProofEvidenceRefV1RawSchema,
});
export const EvidenceRefV1Schema = frozenCompositeSchema(EvidenceRefV1RawSchema);

export interface RequirementResponseV1 {
  readonly id: string;
  readonly sourceRefIds: readonly string[];
  readonly category:
    | "qualification"
    | "commercial"
    | "technical"
    | "service"
    | "price"
    | "submission";
  readonly requirementText: string;
  readonly substantial: boolean;
  readonly responseStatus: "not-started" | "drafted" | "reviewed";
  readonly responseText: string;
  readonly offeredValue?: string;
  readonly compliance: "yes" | "partial" | "no" | "unreviewed";
  readonly evidenceRefIds: readonly string[];
  readonly owner?: string;
  readonly reviewStatus: "pending" | "accepted" | "rejected";
}

const RequirementResponseV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  sourceRefIds: isolatedArraySchema(IdentifierRawSchema, {
    min: 1,
    max: 100,
    refine: (values, addIssue) => uniqueStrings(values, addIssue, "Requirement source refs"),
  }),
  category: z.enum(["qualification", "commercial", "technical", "service", "price", "submission"]),
  requirementText: safeText(10_000, true),
  substantial: z.boolean(),
  responseStatus: z.enum(["not-started", "drafted", "reviewed"]),
  responseText: safeText(10_000),
  offeredValue: safeText(2_000, true).optional(),
  compliance: z.enum(["yes", "partial", "no", "unreviewed"]),
  evidenceRefIds: isolatedArraySchema(IdentifierRawSchema, {
    max: 100,
    refine: (values, addIssue) => uniqueStrings(values, addIssue, "Requirement evidence refs"),
  }),
  owner: safeText(200, true).optional(),
  reviewStatus: z.enum(["pending", "accepted", "rejected"]),
});
export const RequirementResponseV1Schema = frozenCompositeSchema(RequirementResponseV1RawSchema, {
  arrayLimits: { sourceRefIds: 100, evidenceRefIds: 100 },
});

export interface QualificationItemV1 {
  readonly id: string;
  readonly sourceRefIds: readonly string[];
  readonly name: string;
  readonly required: boolean;
  readonly issuer?: string;
  readonly certificateNumber?: string;
  readonly validUntil?: string;
  readonly attachmentId?: string;
  readonly status: "missing" | "attached" | "not-applicable";
  readonly userConfirmedTruth: boolean;
}

const QualificationItemV1RawSchema = strictIsolatedObjectSchema(
  {
    id: IdentifierRawSchema,
    sourceRefIds: isolatedArraySchema(IdentifierRawSchema, {
      min: 1,
      max: 100,
      refine: (values, addIssue) => uniqueStrings(values, addIssue, "Qualification source refs"),
    }),
    name: safeText(500, true),
    required: z.boolean(),
    issuer: safeText(300, true).optional(),
    certificateNumber: safeText(200, true).optional(),
    validUntil: DateRawSchema.optional(),
    attachmentId: IdentifierRawSchema.optional(),
    status: z.enum(["missing", "attached", "not-applicable"]),
    userConfirmedTruth: z.boolean(),
  },
  (qualification, addIssue) => {
    if (qualification.status === "attached" && qualification.attachmentId === undefined) {
      addIssue({ code: "custom", message: "Attached qualification requires an attachment id" });
    }
    if (qualification.status !== "attached" && qualification.attachmentId !== undefined) {
      addIssue({
        code: "custom",
        message: "Only attached qualifications can reference an attachment",
      });
    }
  },
);
export const QualificationItemV1Schema = frozenCompositeSchema(QualificationItemV1RawSchema, {
  arrayLimits: { sourceRefIds: 100 },
});

export interface BidPriceDeclarationV1 {
  readonly itemizedTotalMinor: string;
  readonly bidLetterTotalMinor: string;
  readonly openingTotalMinor: string;
  readonly userConfirmed: boolean;
}

const BidPriceDeclarationV1RawSchema = strictIsolatedObjectSchema({
  itemizedTotalMinor: MoneyMinorV2Schema,
  bidLetterTotalMinor: MoneyMinorV2Schema,
  openingTotalMinor: MoneyMinorV2Schema,
  userConfirmed: z.boolean(),
});
export const BidPriceDeclarationV1Schema = frozenCompositeSchema(BidPriceDeclarationV1RawSchema);

export interface BidGuaranteeRecordV1 {
  readonly method: string;
  readonly amountMinor: string;
  readonly reference: string;
  readonly attachmentId?: string;
  readonly userConfirmed: boolean;
}

const BidGuaranteeRecordV1RawSchema = strictIsolatedObjectSchema({
  method: safeText(100, true),
  amountMinor: MoneyMinorV2Schema,
  reference: safeText(300, true),
  attachmentId: IdentifierRawSchema.optional(),
  userConfirmed: z.boolean(),
});
export const BidGuaranteeRecordV1Schema = frozenCompositeSchema(BidGuaranteeRecordV1RawSchema);

export interface SignSealChecklistItemV1 {
  readonly id: string;
  readonly sourceRefIds: readonly string[];
  readonly label: string;
  readonly required: boolean;
  readonly confirmed: boolean;
}

const SignSealChecklistItemV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  sourceRefIds: isolatedArraySchema(IdentifierRawSchema, {
    min: 1,
    max: 100,
    refine: (values, addIssue) => uniqueStrings(values, addIssue, "Sign and seal source refs"),
  }),
  label: safeText(500, true),
  required: z.boolean(),
  confirmed: z.boolean(),
});
export const SignSealChecklistItemV1Schema = frozenCompositeSchema(
  SignSealChecklistItemV1RawSchema,
  { arrayLimits: { sourceRefIds: 100 } },
);

export interface DeviationEntryV1 {
  readonly requirementId: string;
  readonly type: "business" | "technical";
  readonly sourceRefIds: readonly string[];
  readonly requirement: string;
  readonly response: string;
  readonly deviation: string;
}

const DeviationEntryV1RawSchema = strictIsolatedObjectSchema({
  requirementId: IdentifierRawSchema,
  type: z.enum(["business", "technical"]),
  sourceRefIds: isolatedArraySchema(IdentifierRawSchema, {
    min: 1,
    max: 100,
    refine: (values, addIssue) => uniqueStrings(values, addIssue, "Deviation source refs"),
  }),
  requirement: safeText(10_000, true),
  response: safeText(10_000, true),
  deviation: safeText(10_000, true),
});
export const DeviationEntryV1Schema = frozenCompositeSchema(DeviationEntryV1RawSchema, {
  arrayLimits: { sourceRefIds: 100 },
});

export interface BidProjectReferenceV1 {
  readonly id: string;
  readonly projectName: string;
  readonly customer: string;
  readonly period: string;
  readonly scope: string;
  readonly evidenceAttachmentId?: string;
  readonly userConfirmedTruth: boolean;
}

const BidProjectReferenceV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  projectName: safeText(500, true),
  customer: safeText(500, true),
  period: safeText(300, true),
  scope: safeText(2_000, true),
  evidenceAttachmentId: IdentifierRawSchema.optional(),
  userConfirmedTruth: z.boolean(),
});
export const BidProjectReferenceV1Schema = frozenCompositeSchema(BidProjectReferenceV1RawSchema);

const AttachmentRefV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  category: z.enum(["qualification", "technical", "commercial", "other"]),
  displayName: safeText(500, true),
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  pageCount: z.number().int().min(1).max(10_000).optional(),
  required: z.boolean(),
  sourceRef: safeText(500, true).optional(),
  localBlobKey: safeText(500, true).optional(),
  status: z.enum(["missing", "attached", "rejected"]),
  includedInSubmission: z.boolean(),
});

const FinalReviewerV1RawSchema = strictIsolatedObjectSchema({
  name: safeText(200, true),
  role: safeText(200, true),
  reviewedAt: OffsetDateTimeRawSchema,
});

export interface BidDraftBaseV1 {
  readonly id: string;
  readonly templateId: (typeof BID_TEMPLATE_IDS)[number];
  readonly templateVersion: "1.0.0";
  readonly source: SolicitationSnapshotV1;
  readonly bidder: EntityPartyV2;
  readonly authorizedRepresentative?: string;
  readonly consortiumMembers: readonly EntityPartyV2[];
  readonly requirements: readonly RequirementResponseV1[];
  readonly qualifications: readonly QualificationItemV1[];
  readonly evidenceRefs: readonly EvidenceRefV1[];
  readonly businessDeviations: readonly DeviationEntryV1[];
  readonly technicalDeviations: readonly DeviationEntryV1[];
  readonly projectReferences: readonly BidProjectReferenceV1[];
  readonly attachments: readonly AttachmentRefV1[];
  readonly priceDeclaration: BidPriceDeclarationV1;
  readonly bidGuarantee?: BidGuaranteeRecordV1;
  readonly signSealChecklist: readonly SignSealChecklistItemV1[];
  readonly finalReviewers: readonly {
    readonly name: string;
    readonly role: string;
    readonly reviewedAt: string;
  }[];
  readonly updatedAt: string;
}

const BidDraftBaseV1RawSchema = strictIsolatedObjectSchema(
  {
    id: IdentifierRawSchema,
    templateId: z.enum(BID_TEMPLATE_IDS),
    templateVersion: z.literal("1.0.0"),
    source: SolicitationSnapshotV1RawSchema,
    bidder: PartyV2Schema,
    authorizedRepresentative: safeText(200, true).optional(),
    consortiumMembers: isolatedArraySchema(PartyV2Schema, { max: 20 }),
    requirements: isolatedArraySchema(RequirementResponseV1RawSchema, {
      max: 500,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Requirement"),
    }),
    qualifications: isolatedArraySchema(QualificationItemV1RawSchema, {
      max: 200,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Qualification"),
    }),
    evidenceRefs: isolatedArraySchema(EvidenceRefV1RawSchema, {
      max: 100,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Evidence"),
    }),
    businessDeviations: isolatedArraySchema(DeviationEntryV1RawSchema, { max: 200 }),
    technicalDeviations: isolatedArraySchema(DeviationEntryV1RawSchema, { max: 200 }),
    projectReferences: isolatedArraySchema(BidProjectReferenceV1RawSchema, {
      max: 100,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Project reference"),
    }),
    attachments: isolatedArraySchema(AttachmentRefV1RawSchema, {
      max: 100,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Attachment"),
    }),
    priceDeclaration: BidPriceDeclarationV1RawSchema,
    bidGuarantee: BidGuaranteeRecordV1RawSchema.optional(),
    signSealChecklist: isolatedArraySchema(SignSealChecklistItemV1RawSchema, {
      max: 100,
      refine: (values, addIssue) => uniqueIds(values, addIssue, "Sign and seal checklist"),
    }),
    finalReviewers: isolatedArraySchema(FinalReviewerV1RawSchema, { max: 100 }),
    updatedAt: OffsetDateTimeRawSchema,
  },
  (draft, addIssue) => {
    const attachments = new Map(draft.attachments.map((item) => [item.id, item]));
    const requirements = new Set(draft.requirements.map((item) => item.id));
    const sourceEvidence = new Set(
      draft.evidenceRefs.filter((item) => item.kind === "solicitation").map((item) => item.id),
    );
    const proofEvidence = new Set(
      draft.evidenceRefs.filter((item) => item.kind === "proof").map((item) => item.id),
    );

    const requireAttachment = (attachmentId: string, path: PropertyKey[]) => {
      if (!attachments.has(attachmentId)) {
        addIssue({ code: "custom", message: "Attachment reference does not exist", path });
      }
    };
    const requireSourceRefs = (ids: readonly string[], path: PropertyKey[]) => {
      ids.forEach((id, index) => {
        if (!sourceEvidence.has(id)) {
          addIssue({
            code: "custom",
            message: "Solicitation source reference does not exist",
            path: [...path, index],
          });
        }
      });
    };

    const mainAttachmentId = draft.source.versionEvidence.mainSolicitationAttachmentId;
    if (mainAttachmentId !== undefined) {
      requireAttachment(mainAttachmentId, [
        "source",
        "versionEvidence",
        "mainSolicitationAttachmentId",
      ]);
    }
    draft.source.versionEvidence.clarificationAttachments.forEach((item, index) => {
      requireAttachment(item.attachmentId, [
        "source",
        "versionEvidence",
        "clarificationAttachments",
        index,
        "attachmentId",
      ]);
    });
    requireSourceRefs(draft.source.guaranteeRequirement.sourceRefIds, [
      "source",
      "guaranteeRequirement",
      "sourceRefIds",
    ]);

    draft.evidenceRefs.forEach((item, index) => {
      requireAttachment(item.attachmentId, ["evidenceRefs", index, "attachmentId"]);
    });
    draft.requirements.forEach((item, index) => {
      requireSourceRefs(item.sourceRefIds, ["requirements", index, "sourceRefIds"]);
      item.evidenceRefIds.forEach((id, evidenceIndex) => {
        if (!proofEvidence.has(id)) {
          addIssue({
            code: "custom",
            message: "Proof evidence reference does not exist",
            path: ["requirements", index, "evidenceRefIds", evidenceIndex],
          });
        }
      });
    });
    draft.qualifications.forEach((item, index) => {
      requireSourceRefs(item.sourceRefIds, ["qualifications", index, "sourceRefIds"]);
      if (item.attachmentId !== undefined) {
        requireAttachment(item.attachmentId, ["qualifications", index, "attachmentId"]);
      }
    });
    draft.signSealChecklist.forEach((item, index) => {
      requireSourceRefs(item.sourceRefIds, ["signSealChecklist", index, "sourceRefIds"]);
    });
    draft.projectReferences.forEach((item, index) => {
      if (item.evidenceAttachmentId !== undefined) {
        requireAttachment(item.evidenceAttachmentId, [
          "projectReferences",
          index,
          "evidenceAttachmentId",
        ]);
      }
    });
    if (draft.bidGuarantee?.attachmentId !== undefined) {
      requireAttachment(draft.bidGuarantee.attachmentId, ["bidGuarantee", "attachmentId"]);
    }

    const seenDeviationRequirements = new Set<string>();
    const deviationGroups = [
      ["businessDeviations", "business", draft.businessDeviations],
      ["technicalDeviations", "technical", draft.technicalDeviations],
    ] as const;
    for (const [field, expectedType, deviations] of deviationGroups) {
      deviations.forEach((item, index) => {
        if (!requirements.has(item.requirementId)) {
          addIssue({
            code: "custom",
            message: "Deviation requirement does not exist",
            path: [field, index, "requirementId"],
          });
        }
        if (item.type !== expectedType) {
          addIssue({
            code: "custom",
            message: "Deviation type does not match its matrix",
            path: [field, index, "type"],
          });
        }
        if (seenDeviationRequirements.has(item.requirementId)) {
          addIssue({
            code: "custom",
            message: "requirementId is the deviation primary key",
            path: [field, index, "requirementId"],
          });
        }
        seenDeviationRequirements.add(item.requirementId);
        requireSourceRefs(item.sourceRefIds, [field, index, "sourceRefIds"]);
      });
    }
  },
);

const BID_DRAFT_ARRAY_LIMITS = Object.freeze({
  allowedMethods: 10,
  attachments: 100,
  businessDeviations: 200,
  clarificationAttachments: 100,
  clarificationIds: 100,
  consortiumMembers: 20,
  evidenceRefIds: 100,
  evidenceRefs: 100,
  finalReviewers: 100,
  projectReferences: 100,
  qualifications: 200,
  requirements: 500,
  signSealChecklist: 100,
  sourceRefIds: 100,
  technicalDeviations: 200,
});

export const BidDraftBaseV1Schema = frozenCompositeSchema(BidDraftBaseV1RawSchema, {
  arrayLimits: BID_DRAFT_ARRAY_LIMITS,
});

function finding(code: string, message: string, path?: readonly string[]): RiskFindingV2 {
  return RiskFindingV2Schema.parse({
    code,
    severity: "error",
    impact: "blockSubmission",
    message,
    ...(path === undefined ? {} : { path }),
  });
}

function isAttachmentReady(attachment: AttachmentRefV1 | undefined): boolean {
  return attachment?.status === "attached" && attachment.includedInSubmission;
}

export function preflightBidCommon(input: unknown): readonly RiskFindingV2[] {
  const draft = BidDraftBaseV1Schema.parse(input);
  const findings: RiskFindingV2[] = [];
  const attachments = new Map(draft.attachments.map((item) => [item.id, item]));
  const evidence = new Map(draft.evidenceRefs.map((item) => [item.id, item]));
  const deviations = new Set(
    [...draft.businessDeviations, ...draft.technicalDeviations].map((item) => item.requirementId),
  );

  if (draft.attachments.some((item) => item.required && !isAttachmentReady(item))) {
    findings.push(
      finding(
        "BID_REQUIRED_ATTACHMENT_NOT_READY",
        "A required manifest attachment is not attached and included",
      ),
    );
  }

  const sourceAttachmentIds = new Set<string>();
  const mainAttachmentId = draft.source.versionEvidence.mainSolicitationAttachmentId;
  if (mainAttachmentId !== undefined) sourceAttachmentIds.add(mainAttachmentId);
  for (const item of draft.source.versionEvidence.clarificationAttachments) {
    sourceAttachmentIds.add(item.attachmentId);
  }
  for (const ref of draft.evidenceRefs) {
    if (ref.kind === "solicitation") sourceAttachmentIds.add(ref.attachmentId);
  }
  if ([...sourceAttachmentIds].some((id) => !isAttachmentReady(attachments.get(id)))) {
    findings.push(
      finding(
        "BID_SOURCE_ATTACHMENT_NOT_READY",
        "A referenced solicitation attachment is not ready",
      ),
    );
  }

  const proofAttachmentIds = new Set(
    draft.evidenceRefs.filter((item) => item.kind === "proof").map((item) => item.attachmentId),
  );
  if ([...proofAttachmentIds].some((id) => !isAttachmentReady(attachments.get(id)))) {
    findings.push(
      finding("BID_EVIDENCE_ATTACHMENT_NOT_READY", "A referenced proof attachment is not ready"),
    );
  }

  draft.requirements.forEach((item, index) => {
    if (
      item.substantial &&
      (item.responseStatus !== "reviewed" || item.reviewStatus !== "accepted")
    ) {
      findings.push(
        finding(
          "BID_SUBSTANTIAL_REQUIREMENT_NOT_ACCEPTED",
          "A substantial requirement has not completed accepted review",
          ["requirements", String(index)],
        ),
      );
    }
    if (item.substantial && item.compliance !== "yes") {
      findings.push(
        finding(
          "BID_SUBSTANTIAL_REQUIREMENT_NONCOMPLIANT",
          "A substantial requirement is not marked compliant",
          ["requirements", String(index)],
        ),
      );
    }
    if ((item.compliance === "partial" || item.compliance === "no") && !deviations.has(item.id)) {
      findings.push(
        finding(
          "BID_DEVIATION_MISSING",
          "A partial or noncompliant response requires a keyed deviation",
          ["requirements", String(index)],
        ),
      );
    }
    for (const refId of item.evidenceRefIds) {
      const ref = evidence.get(refId);
      if (ref?.kind === "proof" && !isAttachmentReady(attachments.get(ref.attachmentId))) {
        findings.push(
          finding(
            "BID_EVIDENCE_ATTACHMENT_NOT_READY",
            "A requirement proof attachment is not ready",
            ["requirements", String(index)],
          ),
        );
        break;
      }
    }
  });

  draft.qualifications.forEach((item, index) => {
    if (item.required && item.status !== "attached") {
      findings.push(
        finding("BID_QUALIFICATION_REQUIRED_MISSING", "A required qualification is not attached", [
          "qualifications",
          String(index),
        ]),
      );
    }
    if (item.status === "attached" && !item.userConfirmedTruth) {
      findings.push(
        finding(
          "BID_QUALIFICATION_TRUTH_UNCONFIRMED",
          "An attached qualification has not been truth-confirmed",
          ["qualifications", String(index)],
        ),
      );
    }
    if (
      item.status === "attached" &&
      item.attachmentId !== undefined &&
      !isAttachmentReady(attachments.get(item.attachmentId))
    ) {
      findings.push(
        finding("BID_EVIDENCE_ATTACHMENT_NOT_READY", "A qualification attachment is not ready", [
          "qualifications",
          String(index),
        ]),
      );
    }
  });

  draft.projectReferences.forEach((item, index) => {
    if (!item.userConfirmedTruth) {
      findings.push(
        finding(
          "BID_PROJECT_REFERENCE_TRUTH_UNCONFIRMED",
          "A project reference has not been truth-confirmed",
          ["projectReferences", String(index)],
        ),
      );
    }
    if (
      item.evidenceAttachmentId !== undefined &&
      !isAttachmentReady(attachments.get(item.evidenceAttachmentId))
    ) {
      findings.push(
        finding(
          "BID_EVIDENCE_ATTACHMENT_NOT_READY",
          "A project reference attachment is not ready",
          ["projectReferences", String(index)],
        ),
      );
    }
  });

  if (draft.signSealChecklist.some((item) => item.required && !item.confirmed)) {
    findings.push(
      finding("BID_SIGN_SEAL_UNCONFIRMED", "A required signature or seal is unconfirmed"),
    );
  }

  const guaranteeRequirement = draft.source.guaranteeRequirement;
  if (guaranteeRequirement.required) {
    if (draft.bidGuarantee === undefined) {
      findings.push(finding("BID_GUARANTEE_MISSING", "The required bid guarantee is missing"));
    } else {
      if (!draft.bidGuarantee.userConfirmed) {
        findings.push(
          finding("BID_GUARANTEE_UNCONFIRMED", "The bid guarantee is not user-confirmed"),
        );
      }
      if (
        !guaranteeRequirement.allowedMethods.includes(draft.bidGuarantee.method) ||
        guaranteeRequirement.amountMinor !== draft.bidGuarantee.amountMinor
      ) {
        findings.push(
          finding("BID_GUARANTEE_MISMATCH", "The bid guarantee does not match the requirement"),
        );
      }
      if (
        draft.bidGuarantee.attachmentId === undefined ||
        !isAttachmentReady(attachments.get(draft.bidGuarantee.attachmentId))
      ) {
        findings.push(
          finding("BID_GUARANTEE_ATTACHMENT_NOT_READY", "The guarantee attachment is not ready"),
        );
      }
    }
  }

  if (!draft.priceDeclaration.userConfirmed) {
    findings.push(finding("BID_PRICE_UNCONFIRMED", "The bid price has not been user-confirmed"));
  }
  const totals = [
    BigInt(draft.priceDeclaration.itemizedTotalMinor),
    BigInt(draft.priceDeclaration.bidLetterTotalMinor),
    BigInt(draft.priceDeclaration.openingTotalMinor),
  ];
  if (totals[0] !== totals[1] || totals[0] !== totals[2]) {
    findings.push(
      finding("BID_PRICE_TOTAL_MISMATCH", "The itemized, bid-letter, and opening totals differ"),
    );
  }
  if (
    draft.source.maximumPriceMinor !== undefined &&
    totals.some((total) => total > BigInt(draft.source.maximumPriceMinor as string))
  ) {
    findings.push(
      finding("BID_PRICE_ABOVE_MAXIMUM", "A declared bid total exceeds the maximum price"),
    );
  }
  if (!draft.source.jointVentureAllowed && draft.consortiumMembers.length > 0) {
    findings.push(
      finding("BID_CONSORTIUM_NOT_ALLOWED", "Consortium members are present but not allowed"),
    );
  }

  return Object.freeze(findings);
}

export type BidExportModeV1 = "internal-draft" | "review-copy" | "submission-ready";

export interface BidExportDecisionV1 {
  readonly mode: BidExportModeV1;
  readonly canExportSubmission: boolean;
  readonly watermarks: readonly WatermarkPolicyV2[];
  readonly blockingCodes: readonly string[];
  readonly reviewCodes: readonly string[];
  readonly submissionChecks: readonly string[];
}

const LocalizedWatermarkTextRawSchema = strictIsolatedObjectSchema({
  zhCN: safeText(500, true),
  enUS: safeText(500, true),
});
const WatermarkPolicyV2RawSchema = strictIsolatedObjectSchema({
  id: IdentifierRawSchema,
  text: LocalizedWatermarkTextRawSchema,
  scope: z.literal("every-page"),
});
const DecisionCodesRawSchema = isolatedArraySchema(IdentifierRawSchema, {
  max: 500,
  refine: (values, addIssue) => uniqueStrings(values, addIssue, "Decision codes"),
});
const SubmissionChecksRawSchema = isolatedArraySchema(IdentifierRawSchema, {
  max: 10,
  refine: (values, addIssue) => uniqueStrings(values, addIssue, "Submission checks"),
});

const BidExportDecisionV1RawSchema = strictIsolatedObjectSchema(
  {
    mode: z.enum(["internal-draft", "review-copy", "submission-ready"]),
    canExportSubmission: z.boolean(),
    watermarks: isolatedArraySchema(WatermarkPolicyV2RawSchema, { max: 1 }),
    blockingCodes: DecisionCodesRawSchema,
    reviewCodes: DecisionCodesRawSchema,
    submissionChecks: SubmissionChecksRawSchema,
  },
  (decision, addIssue) => {
    const expectedWatermark =
      decision.mode === "internal-draft"
        ? "unbound-source"
        : decision.mode === "review-copy"
          ? "review-copy"
          : undefined;
    if (decision.canExportSubmission !== (decision.mode === "submission-ready")) {
      addIssue({ code: "custom", message: "Export capability does not match the decision mode" });
    }
    if (
      (expectedWatermark === undefined && decision.watermarks.length !== 0) ||
      (expectedWatermark !== undefined &&
        (decision.watermarks.length !== 1 || decision.watermarks[0]?.id !== expectedWatermark))
    ) {
      addIssue({ code: "custom", message: "Watermark policy does not match the decision mode" });
    }
    if (
      decision.mode === "submission-ready" &&
      (decision.blockingCodes.length > 0 ||
        decision.reviewCodes.length > 0 ||
        decision.submissionChecks.length > 0)
    ) {
      addIssue({
        code: "custom",
        message: "A submission-ready decision cannot carry review codes",
      });
    }
  },
);
export const BidExportDecisionV1Schema = frozenCompositeSchema(BidExportDecisionV1RawSchema, {
  arrayLimits: { blockingCodes: 500, reviewCodes: 500, submissionChecks: 10, watermarks: 1 },
});

const BidExportInputV1RawSchema = strictIsolatedObjectSchema({
  draft: BidDraftBaseV1RawSchema,
  findings: isolatedArraySchema(RiskFindingV2Schema, { max: 500 }),
  asOf: OffsetDateTimeRawSchema.optional(),
});
const BidExportInputV1Schema = frozenCompositeSchema(BidExportInputV1RawSchema, {
  arrayLimits: {
    ...BID_DRAFT_ARRAY_LIMITS,
    findings: 500,
    path: 20,
  },
});

const SOURCE_PLACEHOLDER_PATTERN =
  /(?:\bTBD\b|\bTO\s+BE\s+(?:DETERMINED|CONFIRMED|PROVIDED)\b|待定|待补|待确认|未确认|未绑定|待填写)/iu;

function exactSourceVersionIsComplete(source: SolicitationSnapshotV1): boolean {
  const completeText = (value: string | undefined): boolean =>
    value !== undefined && value.trim().length > 0 && !SOURCE_PLACEHOLDER_PATTERN.test(value);
  const evidence = source.versionEvidence;
  const clarificationIds = new Set(source.clarificationIds);
  const evidencedClarifications = new Set(
    evidence.clarificationAttachments.map((item) => item.clarificationId),
  );
  return Boolean(
    completeText(source.issuer) &&
      completeText(source.projectName) &&
      completeText(source.projectNumber) &&
      completeText(source.versionLabel) &&
      completeText(source.issueDate) &&
      completeText(source.bidDeadline) &&
      completeText(source.openingTime) &&
      completeText(source.openingPlace) &&
      completeText(source.signatureRules) &&
      completeText(source.sealingRules) &&
      completeText(evidence.mainSolicitationAttachmentId) &&
      evidence.allClarificationsIncluded &&
      evidence.userConfirmedExactVersion &&
      clarificationIds.size === evidencedClarifications.size &&
      [...clarificationIds].every((id) => evidencedClarifications.has(id)),
  );
}

function stableUnique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  }
  return output;
}

const MAX_DECISION_CODES = 500;
const TRUNCATED_FINDING_CODE = "BID_FINDING_CODES_TRUNCATED";

function stableCappedCodes(
  priorityCodes: readonly string[],
  externalCodes: readonly string[],
): string[] {
  const combined = stableUnique([...priorityCodes, ...externalCodes]).filter(
    (code) => code !== TRUNCATED_FINDING_CODE,
  );
  if (combined.length <= MAX_DECISION_CODES) return combined;
  return [...combined.slice(0, MAX_DECISION_CODES - 1), TRUNCATED_FINDING_CODE];
}

const INTERNAL_DRAFT_WATERMARK = Object.freeze({
  id: "unbound-source",
  text: Object.freeze({
    zhCN: "内部投标底稿 · 未绑定完整招标文件版本 · 不得提交",
    enUS: "INTERNAL BID DRAFT · SOURCE VERSION INCOMPLETE · DO NOT SUBMIT",
  }),
  scope: "every-page" as const,
});
const REVIEW_COPY_WATERMARK = Object.freeze({
  id: "review-copy",
  text: Object.freeze({ zhCN: "审核稿 · 不得提交", enUS: "REVIEW COPY · DO NOT SUBMIT" }),
  scope: "every-page" as const,
});

export function decideBidExport(input: unknown): BidExportDecisionV1 {
  const parsed = BidExportInputV1Schema.parse(input);
  const source = parsed.draft.source;
  const canonicalFindings = preflightBidCommon(parsed.draft);
  const deadlineNotEvaluated = parsed.asOf === undefined;
  const deadlineReached =
    !deadlineNotEvaluated &&
    source.bidDeadline !== "" &&
    Date.parse(parsed.asOf as string) >= Date.parse(source.bidDeadline);
  const canonicalBlockingCodes = canonicalFindings
    .filter((item) => item.impact === "blockSubmission")
    .map((item) => item.code);
  const canonicalReviewCodes = canonicalFindings
    .filter((item) => item.impact === "blockSubmission" || item.impact === "watermark")
    .map((item) => item.code);
  const externalBlockingCodes = parsed.findings
    .filter((item) => item.impact === "blockSubmission")
    .map((item) => item.code);
  const externalReviewCodes = parsed.findings
    .filter((item) => item.impact === "blockSubmission" || item.impact === "watermark")
    .map((item) => item.code);
  const deadlineCodes = deadlineNotEvaluated
    ? ["BID_DEADLINE_NOT_EVALUATED"]
    : deadlineReached
      ? ["BID_DEADLINE_REACHED"]
      : [];
  const internalBlockingCodes = [...canonicalBlockingCodes, ...deadlineCodes];
  const internalReviewCodes = [...canonicalReviewCodes, ...deadlineCodes];
  const blockingCodes = stableCappedCodes(internalBlockingCodes, externalBlockingCodes);
  const reviewCodes = stableCappedCodes(internalReviewCodes, externalReviewCodes);
  const submissionChecks = deadlineNotEvaluated ? ["BID_DEADLINE_NOT_EVALUATED"] : [];

  if (!exactSourceVersionIsComplete(source)) {
    return BidExportDecisionV1Schema.parse({
      mode: "internal-draft",
      canExportSubmission: false,
      watermarks: [INTERNAL_DRAFT_WATERMARK],
      blockingCodes: stableCappedCodes(
        ["BID_SOURCE_VERSION_INCOMPLETE", ...internalBlockingCodes],
        externalBlockingCodes,
      ),
      reviewCodes: stableCappedCodes(
        ["BID_SOURCE_VERSION_INCOMPLETE", ...internalReviewCodes],
        externalReviewCodes,
      ),
      submissionChecks,
    });
  }

  if (reviewCodes.length > 0) {
    return BidExportDecisionV1Schema.parse({
      mode: "review-copy",
      canExportSubmission: false,
      watermarks: [REVIEW_COPY_WATERMARK],
      blockingCodes,
      reviewCodes,
      submissionChecks,
    });
  }

  return BidExportDecisionV1Schema.parse({
    mode: "submission-ready",
    canExportSubmission: true,
    watermarks: [],
    blockingCodes: [],
    reviewCodes: [],
    submissionChecks,
  });
}
