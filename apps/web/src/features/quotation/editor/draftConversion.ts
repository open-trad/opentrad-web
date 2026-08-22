import {
  DocumentDraftSchema,
  STANDARD_GOODS_QUOTE_TEMPLATE_ID,
  STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";

export type ConversionResult<T> = { ok: true; value: T } | { ok: false; message: string };

const MONEY_ERROR = "请输入非负金额，最多保留 2 位小数";
const PERCENT_ERROR = "请输入 0 到 100 之间的百分比，最多保留 2 位小数";
const QUANTITY_ERROR = "请输入大于 0 的数量，整数最多 12 位、小数最多 6 位";

function decimalParts(input: string, maximumFractionDigits: number) {
  if (input.length > 32) {
    return null;
  }
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${maximumFractionDigits}}))?$`, "u").exec(input);
  if (!match) {
    return null;
  }
  return { whole: match[1] ?? "", fraction: match[2] ?? "" };
}

function normalizedWhole(input: string): string {
  return input.replace(/^0+(?=\d)/u, "");
}

export function parseMajorMoneyToMinor(input: string): ConversionResult<string> {
  const parts = decimalParts(input, 2);
  if (!parts) {
    return { ok: false, message: MONEY_ERROR };
  }
  const minor = BigInt(`${normalizedWhole(parts.whole)}${parts.fraction.padEnd(2, "0")}`);
  if (minor > 999_999_999_999_999_999n) {
    return { ok: false, message: MONEY_ERROR };
  }
  return { ok: true, value: minor.toString() };
}

export function parsePercentToBps(input: string): ConversionResult<number> {
  const parts = decimalParts(input, 2);
  if (!parts) {
    return { ok: false, message: PERCENT_ERROR };
  }
  const basisPoints = BigInt(`${normalizedWhole(parts.whole)}${parts.fraction.padEnd(2, "0")}`);
  if (basisPoints > 10_000n) {
    return { ok: false, message: PERCENT_ERROR };
  }
  return { ok: true, value: Number(basisPoints) };
}

export function normalizeQuantity(input: string): ConversionResult<string> {
  const parts = decimalParts(input, 6);
  if (!parts) {
    return { ok: false, message: QUANTITY_ERROR };
  }
  const whole = normalizedWhole(parts.whole);
  const fraction = parts.fraction.replace(/0+$/u, "");
  if (whole.length > 12 || (BigInt(whole) === 0n && !/[1-9]/u.test(fraction))) {
    return { ok: false, message: QUANTITY_ERROR };
  }
  return { ok: true, value: fraction ? `${whole}.${fraction}` : whole };
}

export interface FormParty {
  name: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
  taxId: string;
  bankName: string;
  bankAccount: string;
}

export interface FormLineItem {
  id: string;
  name: string;
  sku: string;
  specification: string;
  description: string;
  unit: string;
  quantity: string;
  unitPriceMajor: string;
  discountPercent: string;
  taxRatePercent: string;
}

export interface QuotationFormState {
  id: string;
  meta: StandardGoodsQuoteDraft["meta"];
  seller: FormParty;
  buyer: FormParty;
  lineItems: FormLineItem[];
  terms: {
    delivery: string;
    payment: string;
    quality: string;
    warranty: string;
    notes: string;
  };
}

export type DraftBuildResult =
  | { ok: true; draft: StandardGoodsQuoteDraft }
  | { ok: false; errors: Record<string, string> };

const partyToForm = (party: StandardGoodsQuoteDraft["seller"]): FormParty => ({
  name: party.name,
  address: party.address ?? "",
  contactName: party.contactName ?? "",
  phone: party.phone ?? "",
  email: party.email ?? "",
  taxId: party.taxId ?? "",
  bankName: party.bankName ?? "",
  bankAccount: party.bankAccount ?? "",
});

function minorToMajor(minor: string): string {
  const padded = minor.padStart(3, "0");
  const whole = BigInt(padded.slice(0, -2)).toString();
  const fraction = padded.slice(-2).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function bpsToPercent(basisPoints: number): string {
  const exact = BigInt(basisPoints);
  const whole = exact / 100n;
  const fraction = (exact % 100n).toString().padStart(2, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function draftToFormState(draft: StandardGoodsQuoteDraft): QuotationFormState {
  return {
    id: draft.id,
    meta: { ...draft.meta },
    seller: partyToForm(draft.seller),
    buyer: partyToForm(draft.buyer),
    lineItems: draft.lineItems.map((line) => ({
      id: line.id,
      name: line.name,
      sku: line.sku ?? "",
      specification: line.specification ?? "",
      description: line.description ?? "",
      unit: line.unit,
      quantity: line.quantity,
      unitPriceMajor: minorToMajor(line.unitPriceMinor),
      discountPercent: bpsToPercent(line.discountBps),
      taxRatePercent: bpsToPercent(line.taxRateBps),
    })),
    terms: {
      delivery: draft.terms.delivery ?? "",
      payment: draft.terms.payment ?? "",
      quality: draft.terms.quality ?? "",
      warranty: draft.terms.warranty ?? "",
      notes: draft.terms.notes ?? "",
    },
  };
}

const coreMessageByPath: Record<string, string> = {
  "meta.number": "请填写报价编号",
  "meta.issueDate": "请选择有效的报价日期",
  "meta.validUntil": "请选择不早于报价日期的有效期",
  "seller.name": "请填写报价方名称",
  "buyer.name": "请填写采购方名称",
};

export function buildDraftFromForm(form: QuotationFormState, updatedAt: string): DraftBuildResult {
  const errors: Record<string, string> = {};
  if (!form.seller.name.trim()) errors["seller.name"] = coreMessageByPath["seller.name"] ?? "";
  if (!form.buyer.name.trim()) errors["buyer.name"] = coreMessageByPath["buyer.name"] ?? "";
  if (!form.meta.number.trim()) errors["meta.number"] = coreMessageByPath["meta.number"] ?? "";

  const convertedLines = form.lineItems.map((line, index) => {
    const prefix = `lineItems.${index}`;
    if (!line.name.trim()) errors[`${prefix}.name`] = "请填写商品名称";
    if (!line.unit.trim()) errors[`${prefix}.unit`] = "请填写计量单位";
    const quantity = normalizeQuantity(line.quantity);
    if (!quantity.ok) errors[`${prefix}.quantity`] = quantity.message;
    const money = parseMajorMoneyToMinor(line.unitPriceMajor);
    if (!money.ok) errors[`${prefix}.unitPriceMajor`] = money.message;
    const discount = parsePercentToBps(line.discountPercent);
    if (!discount.ok) errors[`${prefix}.discountPercent`] = discount.message;
    const tax =
      form.meta.taxMode === "tax-exempt"
        ? ({ ok: true, value: 0 } as const)
        : parsePercentToBps(line.taxRatePercent);
    if (!tax.ok) errors[`${prefix}.taxRatePercent`] = tax.message;
    return {
      id: line.id,
      name: line.name,
      sku: line.sku,
      specification: line.specification,
      description: line.description,
      unit: line.unit,
      quantity: quantity.ok ? quantity.value : "1",
      unitPriceMinor: money.ok ? money.value : "0",
      discountBps: discount.ok ? discount.value : 0,
      taxRateBps: tax.ok ? tax.value : 0,
    };
  });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const parsed = DocumentDraftSchema.safeParse({
    id: form.id,
    templateId: STANDARD_GOODS_QUOTE_TEMPLATE_ID,
    templateVersion: STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
    meta: { ...form.meta, language: "zh-CN", layout: "classic" },
    seller: { ...form.seller },
    buyer: { ...form.buyer },
    lineItems: convertedLines,
    terms: { ...form.terms },
    updatedAt,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors[path] = coreMessageByPath[path] ?? "请检查此字段的格式或长度";
    }
    return { ok: false, errors };
  }
  return { ok: true, draft: parsed.data };
}
