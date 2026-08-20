import { boundedCompositeSchema } from "../boundaries.js";
import { isolatedArraySchema, isolatedObjectSchema, isolatedValueSchema } from "../safe-schema.js";
import { z } from "../zod.js";

export const BASIS_POINTS_V2_MAX = 10_000;
const BASIS_POINTS_DENOMINATOR = 10_000n;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const CURRENCIES_V2 = Object.freeze(["CNY", "USD", "EUR"] as const);
export type CurrencyV2 = (typeof CURRENCIES_V2)[number];

export const TAX_MODES_V2 = Object.freeze(["tax-excluded", "tax-included", "tax-exempt"] as const);
export type TaxModeV2 = (typeof TAX_MODES_V2)[number];

export interface CalculableLineV2 {
  readonly id: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
}

export interface QuoteCalculationOptionsV2 {
  readonly currency: CurrencyV2;
  readonly taxMode: TaxModeV2;
}

type ExactCalculableLinesV2<Lines extends readonly CalculableLineV2[]> = Exclude<
  keyof Lines[number],
  keyof CalculableLineV2
> extends never
  ? Lines
  : never;

export interface CalculatedQuoteLineV2 {
  readonly lineId: string;
  readonly grossMinor: string;
  readonly discountMinor: string;
  readonly subtotalMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
}

export interface QuoteCalculationSummaryV2 {
  readonly grossMinor: string;
  readonly discountMinor: string;
  readonly subtotalMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
}

export interface QuoteCalculationV2 {
  readonly currency: CurrencyV2;
  readonly taxMode: TaxModeV2;
  readonly lines: readonly CalculatedQuoteLineV2[];
  readonly summary: QuoteCalculationSummaryV2;
}

export interface ProformaOtherChargeV2 {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: string;
}

export interface ProformaAdjustmentsInputV2 {
  readonly currency: CurrencyV2;
  readonly linesTotalMinor: string;
  readonly documentDiscountMinor?: string;
  readonly freightMinor?: string;
  readonly insuranceMinor?: string;
  readonly otherCharges: readonly ProformaOtherChargeV2[];
}

export interface ProformaAdjustmentsV2 {
  readonly currency: CurrencyV2;
  readonly linesTotalMinor: string;
  readonly documentDiscountMinor: string;
  readonly freightMinor: string;
  readonly insuranceMinor: string;
  readonly otherCharges: readonly ProformaOtherChargeV2[];
  readonly otherChargesMinor: string;
  readonly totalMinor: string;
}

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

function frozenCompositeSchema<T extends z.ZodType>(
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
          if (next < 0xdc00 || next > 0xdfff) return false;
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

const IdentifierV2RawSchema = safeText(64, true).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/,
  "Expected a stable identifier",
);
const CurrencyV2RawSchema = z.enum(CURRENCIES_V2);
const TaxModeV2RawSchema = z.enum(TAX_MODES_V2);
const MoneyMinorV2RawSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})$/);
const CalculatedMoneyMinorV2RawSchema = z.string().regex(/^(?:0|[1-9]\d{0,33})$/);
const QuantityV2RawSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  .refine((value) => !/^0(?:\.0+)?$/.test(value), "Quantity must be positive");
const BasisPointsV2RawSchema = z.number().int().min(0).max(BASIS_POINTS_V2_MAX);

export const IdentifierV2Schema = isolatedValueSchema(IdentifierV2RawSchema);
export const CurrencyV2Schema = isolatedValueSchema(CurrencyV2RawSchema);
export const TaxModeV2Schema = isolatedValueSchema(TaxModeV2RawSchema);
export const MoneyMinorV2Schema = isolatedValueSchema(MoneyMinorV2RawSchema);
export const CalculatedMoneyMinorV2Schema = isolatedValueSchema(CalculatedMoneyMinorV2RawSchema);
export const QuantityV2Schema = isolatedValueSchema(QuantityV2RawSchema);
export const BasisPointsV2Schema = isolatedValueSchema(BasisPointsV2RawSchema);

const CalculableLineV2RawSchema = strictIsolatedObjectSchema({
  id: IdentifierV2RawSchema,
  quantity: QuantityV2RawSchema,
  unitPriceMinor: MoneyMinorV2RawSchema,
  discountBps: BasisPointsV2RawSchema,
  taxRateBps: BasisPointsV2RawSchema,
});
export const CalculableLineV2Schema = frozenCompositeSchema(CalculableLineV2RawSchema);

function uniqueIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: SafeIssue) => void,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({ code: "custom", message: "Line ids must be unique", path: [index, "id"] });
    }
    seen.add(value.id);
  });
}

const CalculableLinesV2RawSchema = isolatedArraySchema(CalculableLineV2RawSchema, {
  min: 1,
  max: 100,
  refine: uniqueIds,
});
export const CalculableLinesV2Schema = frozenCompositeSchema(CalculableLinesV2RawSchema, {
  arrayLimits: { lines: 100 },
});

const QuoteCalculationOptionsV2RawSchema = strictIsolatedObjectSchema({
  currency: CurrencyV2RawSchema,
  taxMode: TaxModeV2RawSchema,
});
export const QuoteCalculationOptionsV2Schema = frozenCompositeSchema(
  QuoteCalculationOptionsV2RawSchema,
);

const CalculatedQuoteLineV2RawSchema = strictIsolatedObjectSchema({
  lineId: IdentifierV2RawSchema,
  grossMinor: CalculatedMoneyMinorV2RawSchema,
  discountMinor: CalculatedMoneyMinorV2RawSchema,
  subtotalMinor: CalculatedMoneyMinorV2RawSchema,
  taxMinor: CalculatedMoneyMinorV2RawSchema,
  totalMinor: CalculatedMoneyMinorV2RawSchema,
});

const QuoteCalculationSummaryV2RawSchema = strictIsolatedObjectSchema({
  grossMinor: CalculatedMoneyMinorV2RawSchema,
  discountMinor: CalculatedMoneyMinorV2RawSchema,
  subtotalMinor: CalculatedMoneyMinorV2RawSchema,
  taxMinor: CalculatedMoneyMinorV2RawSchema,
  totalMinor: CalculatedMoneyMinorV2RawSchema,
});

const QuoteCalculationV2RawSchema = strictIsolatedObjectSchema(
  {
    currency: CurrencyV2RawSchema,
    taxMode: TaxModeV2RawSchema,
    lines: isolatedArraySchema(CalculatedQuoteLineV2RawSchema, { min: 1, max: 100 }),
    summary: QuoteCalculationSummaryV2RawSchema,
  },
  (calculation, addIssue) => {
    const seenLineIds = new Set<string>();
    let grossSum = 0n;
    let discountSum = 0n;
    let subtotalSum = 0n;
    let taxSum = 0n;
    let totalSum = 0n;

    calculation.lines.forEach((line, index) => {
      if (seenLineIds.has(line.lineId)) {
        addIssue({
          code: "custom",
          message: "Calculated line ids must be unique",
          path: ["lines", index, "lineId"],
        });
      }
      seenLineIds.add(line.lineId);

      const gross = BigInt(line.grossMinor);
      const discount = BigInt(line.discountMinor);
      const subtotal = BigInt(line.subtotalMinor);
      const tax = BigInt(line.taxMinor);
      const total = BigInt(line.totalMinor);
      grossSum += gross;
      discountSum += discount;
      subtotalSum += subtotal;
      taxSum += tax;
      totalSum += total;

      const discounted = gross - discount;
      const invalidRelationship =
        discount > gross ||
        (calculation.taxMode === "tax-included"
          ? discounted !== total || subtotal + tax !== total
          : discounted !== subtotal || subtotal + tax !== total) ||
        (calculation.taxMode === "tax-exempt" && tax !== 0n);
      if (invalidRelationship) {
        addIssue({
          code: "custom",
          message: "Calculated line amounts are inconsistent with the tax mode",
          path: ["lines", index],
        });
      }
    });

    const summary = calculation.summary;
    if (
      summary.grossMinor !== grossSum.toString() ||
      summary.discountMinor !== discountSum.toString() ||
      summary.subtotalMinor !== subtotalSum.toString() ||
      summary.taxMinor !== taxSum.toString() ||
      summary.totalMinor !== totalSum.toString()
    ) {
      addIssue({
        code: "custom",
        message: "Calculated summary does not match its lines",
        path: ["summary"],
      });
    }
  },
);
export const QuoteCalculationV2Schema = frozenCompositeSchema(QuoteCalculationV2RawSchema, {
  arrayLimits: { lines: 100 },
});

function parseDecimal(value: string): { readonly numerator: bigint; readonly denominator: bigint } {
  const [whole, fraction = ""] = value.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function calculateLineAmountsExact(
  line: CalculableLineV2,
  taxMode: TaxModeV2,
): CalculatedQuoteLineV2 {
  const quantity = parseDecimal(line.quantity);
  const gross = roundHalfUp(BigInt(line.unitPriceMinor) * quantity.numerator, quantity.denominator);
  const discount = roundHalfUp(gross * BigInt(line.discountBps), BASIS_POINTS_DENOMINATOR);
  const afterDiscount = gross - discount;
  const taxRate = BigInt(line.taxRateBps);

  let subtotal = afterDiscount;
  let tax = 0n;
  let total = afterDiscount;
  if (taxMode === "tax-excluded") {
    tax = roundHalfUp(afterDiscount * taxRate, BASIS_POINTS_DENOMINATOR);
    total = afterDiscount + tax;
  } else if (taxMode === "tax-included") {
    tax = roundHalfUp(afterDiscount * taxRate, BASIS_POINTS_DENOMINATOR + taxRate);
    subtotal = afterDiscount - tax;
  }

  return {
    lineId: line.id,
    grossMinor: gross.toString(),
    discountMinor: discount.toString(),
    subtotalMinor: subtotal.toString(),
    taxMinor: tax.toString(),
    totalMinor: total.toString(),
  };
}

function sumCalculatedLines(lines: readonly CalculatedQuoteLineV2[]): QuoteCalculationSummaryV2 {
  let gross = 0n;
  let discount = 0n;
  let subtotal = 0n;
  let tax = 0n;
  let total = 0n;
  for (const line of lines) {
    gross += BigInt(line.grossMinor);
    discount += BigInt(line.discountMinor);
    subtotal += BigInt(line.subtotalMinor);
    tax += BigInt(line.taxMinor);
    total += BigInt(line.totalMinor);
  }
  return {
    grossMinor: gross.toString(),
    discountMinor: discount.toString(),
    subtotalMinor: subtotal.toString(),
    taxMinor: tax.toString(),
    totalMinor: total.toString(),
  };
}

export function calculateQuoteLinesV2<const Lines extends readonly CalculableLineV2[]>(
  lines: Lines & ExactCalculableLinesV2<Lines>,
  options: QuoteCalculationOptionsV2,
): QuoteCalculationV2 {
  const parsedLines = CalculableLinesV2Schema.parse(lines);
  const parsedOptions = QuoteCalculationOptionsV2Schema.parse(options);
  const calculated = parsedLines.map((line) =>
    calculateLineAmountsExact(line, parsedOptions.taxMode),
  );
  return QuoteCalculationV2Schema.parse({
    currency: parsedOptions.currency,
    taxMode: parsedOptions.taxMode,
    lines: calculated,
    summary: sumCalculatedLines(calculated),
  }) as QuoteCalculationV2;
}

export function formatMoneyMinorV2(minor: string, currency: CurrencyV2): string {
  const parsedMinor = CalculatedMoneyMinorV2Schema.parse(minor);
  const parsedCurrency = CurrencyV2Schema.parse(currency);
  const digits = BigInt(parsedMinor).toString().padStart(3, "0");
  const integer = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parsedCurrency} ${integer}.${digits.slice(-2)}`;
}

const ProformaOtherChargeV2RawSchema = strictIsolatedObjectSchema({
  id: IdentifierV2RawSchema,
  label: safeText(200, true),
  amountMinor: MoneyMinorV2RawSchema,
});

const ProformaOtherChargesV2RawSchema = isolatedArraySchema(ProformaOtherChargeV2RawSchema, {
  max: 100,
  refine: uniqueIds,
});

const MAX_MONEY_MINOR = 10n ** 18n - 1n;
const MAX_QUANTITY_NUMERATOR = 10n ** 18n - 1n;
const MAX_QUANTITY_DENOMINATOR = 10n ** 6n;
const MAX_QUOTE_LINES_TOTAL_MINOR =
  roundHalfUp(MAX_MONEY_MINOR * MAX_QUANTITY_NUMERATOR, MAX_QUANTITY_DENOMINATOR) * 2n * 100n;
const ProformaLinesTotalMinorV2RawSchema = CalculatedMoneyMinorV2RawSchema.refine(
  (value) => BigInt(value) <= MAX_QUOTE_LINES_TOTAL_MINOR,
  "Line total exceeds the reachable quotation-calculation domain",
);

const ProformaAdjustmentsInputV2RawSchema = strictIsolatedObjectSchema(
  {
    currency: CurrencyV2RawSchema,
    linesTotalMinor: ProformaLinesTotalMinorV2RawSchema,
    documentDiscountMinor: CalculatedMoneyMinorV2RawSchema.default("0"),
    freightMinor: MoneyMinorV2RawSchema.default("0"),
    insuranceMinor: MoneyMinorV2RawSchema.default("0"),
    otherCharges: ProformaOtherChargesV2RawSchema,
  },
  (input, addIssue) => {
    if (BigInt(input.documentDiscountMinor) > BigInt(input.linesTotalMinor)) {
      addIssue({
        code: "custom",
        message: "Document discount must not exceed the line total",
        path: ["documentDiscountMinor"],
      });
    }
  },
);
export const ProformaAdjustmentsInputV2Schema = frozenCompositeSchema(
  ProformaAdjustmentsInputV2RawSchema,
  { arrayLimits: { otherCharges: 100 } },
);

const ProformaAdjustmentsV2RawSchema = strictIsolatedObjectSchema(
  {
    currency: CurrencyV2RawSchema,
    linesTotalMinor: CalculatedMoneyMinorV2RawSchema,
    documentDiscountMinor: CalculatedMoneyMinorV2RawSchema,
    freightMinor: MoneyMinorV2RawSchema,
    insuranceMinor: MoneyMinorV2RawSchema,
    otherCharges: ProformaOtherChargesV2RawSchema,
    otherChargesMinor: CalculatedMoneyMinorV2RawSchema,
    totalMinor: CalculatedMoneyMinorV2RawSchema,
  },
  (result, addIssue) => {
    const otherCharges = result.otherCharges.reduce(
      (total, charge) => total + BigInt(charge.amountMinor),
      0n,
    );
    const expectedTotal =
      BigInt(result.linesTotalMinor) -
      BigInt(result.documentDiscountMinor) +
      BigInt(result.freightMinor) +
      BigInt(result.insuranceMinor) +
      otherCharges;
    if (BigInt(result.documentDiscountMinor) > BigInt(result.linesTotalMinor)) {
      addIssue({
        code: "custom",
        message: "Document discount must not exceed the line total",
        path: ["documentDiscountMinor"],
      });
    }
    if (result.otherChargesMinor !== otherCharges.toString()) {
      addIssue({
        code: "custom",
        message: "Other-charge summary is inconsistent",
        path: ["otherChargesMinor"],
      });
    }
    if (result.totalMinor !== expectedTotal.toString()) {
      addIssue({
        code: "custom",
        message: "Adjustment total is inconsistent",
        path: ["totalMinor"],
      });
    }
  },
);
export const ProformaAdjustmentsV2Schema = frozenCompositeSchema(ProformaAdjustmentsV2RawSchema, {
  arrayLimits: { otherCharges: 100 },
});

export function calculateProformaAdjustmentsV2(
  input: ProformaAdjustmentsInputV2,
): ProformaAdjustmentsV2 {
  const parsed = ProformaAdjustmentsInputV2Schema.parse(input);
  let otherCharges = 0n;
  for (const charge of parsed.otherCharges) otherCharges += BigInt(charge.amountMinor);
  const total =
    BigInt(parsed.linesTotalMinor) -
    BigInt(parsed.documentDiscountMinor) +
    BigInt(parsed.freightMinor) +
    BigInt(parsed.insuranceMinor) +
    otherCharges;
  return ProformaAdjustmentsV2Schema.parse({
    currency: parsed.currency,
    linesTotalMinor: parsed.linesTotalMinor,
    documentDiscountMinor: parsed.documentDiscountMinor,
    freightMinor: parsed.freightMinor,
    insuranceMinor: parsed.insuranceMinor,
    otherCharges: parsed.otherCharges,
    otherChargesMinor: otherCharges.toString(),
    totalMinor: total.toString(),
  }) as ProformaAdjustmentsV2;
}
