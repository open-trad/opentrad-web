import { boundedCompositeSchema } from "../boundaries.js";
import { isolatedArraySchema, isolatedObjectSchema } from "../safe-schema.js";
import { z } from "../zod.js";

export const EXPORT_IMPACTS_V2 = Object.freeze([
  "advisory",
  "watermark",
  "blockSubmission",
] as const);

export type ExportImpactV2 = (typeof EXPORT_IMPACTS_V2)[number];

export interface RiskFindingV2 {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly impact: ExportImpactV2;
  readonly message: string;
  readonly path?: readonly string[];
}

interface SafeIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || !Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

function safeText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

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
          if (typeof key !== "string" || !allowedKeys.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Unknown object key",
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
    if (!descriptor || !("value" in descriptor))
      throw new Error("Validated output is not data-only");
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

const RiskFindingV2RawSchema = strictIsolatedObjectSchema({
  code: safeText(200, true),
  severity: z.enum(["info", "warning", "error"]),
  impact: z.enum(EXPORT_IMPACTS_V2),
  message: safeText(2_000, true),
  path: isolatedArraySchema(safeText(200, true), { max: 20 }).optional(),
});

const FrozenRiskFindingV2Schema = z.transform<unknown, RiskFindingV2>((input, context) => {
  const result = RiskFindingV2RawSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue({ ...issue });
    return z.NEVER;
  }
  return deepFreeze(result.data) as RiskFindingV2;
});

export const RiskFindingV2Schema = boundedCompositeSchema(FrozenRiskFindingV2Schema, {
  arrayLimits: { path: 20 },
});

const IMPACT_RANK: Readonly<Record<ExportImpactV2, number>> = Object.freeze({
  advisory: 0,
  watermark: 1,
  blockSubmission: 2,
});

export function highestExportImpact(impacts: readonly ExportImpactV2[]): ExportImpactV2 {
  return impacts.reduce<ExportImpactV2>(
    (highest, candidate) => (IMPACT_RANK[candidate] > IMPACT_RANK[highest] ? candidate : highest),
    "advisory",
  );
}
