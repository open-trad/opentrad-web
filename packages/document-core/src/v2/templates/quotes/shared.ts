import { boundedCompositeSchema } from "../../../boundaries.js";
import { isolatedObjectSchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, LocalizedText } from "../../common.js";
import { type RiskFindingV2, RiskFindingV2Schema } from "../../risk.js";

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface SafeIssueV2 {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

export function quoteText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

export function strictQuoteObject<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssueV2) => void) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        for (const key of Reflect.ownKeys(input)) {
          if (typeof key !== "string" || !allowedKeys.has(key) || DANGEROUS_KEYS.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Unknown or dangerous object key",
              path: typeof key === "string" ? [key] : [],
            });
          }
        }
      }
      if (context.issues.length > 0) return z.NEVER;
      const parsed = isolated.safeParse(input);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      return parsed.data;
    } catch {
      context.addIssue({ code: "custom", message: "Object validation failed safely" });
      return z.NEVER;
    }
  });
}

export function deepFreezeQuoteValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("Validated quote output must contain only own data properties");
    }
    deepFreezeQuoteValue(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function frozenQuoteSchema<T extends z.ZodType>(
  schema: T,
  policy: {
    readonly arrayLimits?: Readonly<Record<string, number>>;
    readonly maxTotalValues?: number;
  } = {},
) {
  const frozen = z.transform<unknown, z.output<T>>((input, context) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ ...issue });
      return z.NEVER;
    }
    return deepFreezeQuoteValue(result.data);
  });
  return boundedCompositeSchema(frozen, policy);
}

function isIsoInstant(value: string): boolean {
  if (value.length > 35) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export const IsoInstantV2RawSchema = quoteText(35, true).refine(
  isIsoInstant,
  "Expected a canonical ISO instant",
);

export function utcDraftDates(now: string | Date): {
  readonly issueDate: string;
  readonly validUntil: string;
  readonly updatedAt: string;
} {
  const parsed = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(parsed.getTime())) throw new Error("无效时间");
  const updatedAt = parsed.toISOString();
  const issueDate = updatedAt.slice(0, 10);
  const validity = new Date(`${issueDate}T00:00:00.000Z`);
  validity.setUTCDate(validity.getUTCDate() + 30);
  return { issueDate, validUntil: validity.toISOString().slice(0, 10), updatedAt };
}

export function localized(zhCN: string, enUS?: string): LocalizedText {
  return enUS === undefined ? { zhCN } : { zhCN, enUS };
}

export function partyDetails(party: EntityPartyV2): readonly LocalizedText[] {
  const details = [
    party.registrationId && `登记号：${party.registrationId}`,
    party.taxId && `税号：${party.taxId}`,
    party.registeredAddress && `注册地址：${party.registeredAddress}`,
    `联系人：${party.contactName}`,
    party.phone && `电话：${party.phone}`,
    party.email && `邮箱：${party.email}`,
  ].filter((value): value is string => Boolean(value));
  return details.map((value) => localized(value));
}

export function finding(
  code: string,
  severity: RiskFindingV2["severity"],
  impact: RiskFindingV2["impact"],
  message: string,
  path?: readonly string[],
): RiskFindingV2 {
  return RiskFindingV2Schema.parse({ code, severity, impact, message, path });
}

export function freezeFindings(findings: readonly RiskFindingV2[]): readonly RiskFindingV2[] {
  return Object.freeze([...findings]);
}

export function findingsWatermark(findings: readonly RiskFindingV2[]) {
  return findings.some(
    (candidate) => candidate.impact === "watermark" || candidate.impact === "blockSubmission",
  )
    ? [
        {
          id: "review-required",
          text: localized("审核稿 · 请先处理风险项", "REVIEW COPY · RESOLVE FINDINGS"),
          scope: "every-page" as const,
        },
      ]
    : [];
}

export function hasPlaceholder(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string" && /^(?:待填写|待选择|TBD)$/i.test(current.trim())) {
      return true;
    }
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) return true;
      pending.push(descriptor.value);
    }
  }
  return false;
}
