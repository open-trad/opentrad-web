import {
  type CalculatedLineAmounts,
  type CalculatedSummary,
  parseDocumentDraft,
  type QuoteCalculation,
  QuoteCalculationSchema,
  type StandardGoodsQuoteDraft,
} from "./schemas.js";

const BASIS_POINTS_DENOMINATOR = 10_000n;

function parseDecimal(value: string): { numerator: bigint; denominator: bigint } {
  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator,
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function calculateLine(
  draft: StandardGoodsQuoteDraft,
  line: StandardGoodsQuoteDraft["lineItems"][number],
): CalculatedLineAmounts {
  const quantity = parseDecimal(line.quantity);
  const gross = roundHalfUp(BigInt(line.unitPriceMinor) * quantity.numerator, quantity.denominator);
  const discount = roundHalfUp(gross * BigInt(line.discountBps), BASIS_POINTS_DENOMINATOR);
  const afterDiscount = gross - discount;
  const taxRate = BigInt(line.taxRateBps);

  let subtotal = afterDiscount;
  let tax = 0n;
  let total = afterDiscount;

  if (draft.meta.taxMode === "tax-excluded") {
    tax = roundHalfUp(afterDiscount * taxRate, BASIS_POINTS_DENOMINATOR);
    total = afterDiscount + tax;
  } else if (draft.meta.taxMode === "tax-included") {
    tax = roundHalfUp(afterDiscount * taxRate, BASIS_POINTS_DENOMINATOR + taxRate);
    subtotal = afterDiscount - tax;
  }

  return {
    lineId: line.id,
    grossMinor: gross.toString(),
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxMinor: tax.toString(),
    totalMinor: total.toString(),
  };
}

function sumLines(lines: CalculatedLineAmounts[]): CalculatedSummary {
  const totals = lines.reduce(
    (sum, line) => ({
      gross: sum.gross + BigInt(line.grossMinor),
      subtotal: sum.subtotal + BigInt(line.subtotalMinor),
      discount: sum.discount + BigInt(line.discountMinor),
      tax: sum.tax + BigInt(line.taxMinor),
      total: sum.total + BigInt(line.totalMinor),
    }),
    { gross: 0n, subtotal: 0n, discount: 0n, tax: 0n, total: 0n },
  );

  return {
    grossMinor: totals.gross.toString(),
    subtotalMinor: totals.subtotal.toString(),
    discountMinor: totals.discount.toString(),
    taxMinor: totals.tax.toString(),
    totalMinor: totals.total.toString(),
  };
}

export function calculateQuoteTotals(input: unknown): QuoteCalculation {
  const draft = parseDocumentDraft(input);
  const lines = draft.lineItems.map((line) => calculateLine(draft, line));

  return QuoteCalculationSchema.parse({
    currency: draft.meta.currency,
    taxMode: draft.meta.taxMode,
    lines,
    summary: sumLines(lines),
  });
}
