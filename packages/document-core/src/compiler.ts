import { calculateQuoteTotals } from "./money.js";
import {
  type DocumentModel,
  DocumentModelSchema,
  type Party,
  parseDocumentDraft,
  type StandardGoodsQuoteDraft,
} from "./schemas.js";

function formatMoneyMinor(
  minor: string,
  currency: StandardGoodsQuoteDraft["meta"]["currency"],
): string {
  const padded = minor.padStart(3, "0");
  const integer = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${integer}.${padded.slice(-2)}`;
}

function formatBasisPoints(basisPoints: number): string {
  const exact = BigInt(basisPoints);
  const whole = exact / 100n;
  const fraction = (exact % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

function partyDetails(party: Party): string[] {
  const fields: Array<[string, string | undefined]> = [
    ["地址", party.address],
    ["联系人", party.contactName],
    ["电话", party.phone],
    ["邮箱", party.email],
    ["税号", party.taxId],
    ["开户行", party.bankName],
    ["银行账号", party.bankAccount],
  ];
  return fields
    .filter((field): field is [string, string] => Boolean(field[1]?.trim()))
    .map(([label, value]) => `${label}：${value}`);
}

function taxModeLabel(mode: StandardGoodsQuoteDraft["meta"]["taxMode"]): string {
  if (mode === "tax-included") {
    return "含税报价";
  }
  if (mode === "tax-exempt") {
    return "免税报价";
  }
  return "未税报价";
}

function quoteNatureNotice(nature: StandardGoodsQuoteDraft["meta"]["quoteNature"]): string {
  return nature === "binding-offer"
    ? "本报价为约束性要约，在有效期内按所列条件生效。"
    : "本报价为要约邀请，不构成承诺；以双方最终签署文件为准。";
}

export function compileStandardGoodsQuote(input: unknown): DocumentModel {
  const draft = parseDocumentDraft(input);
  const calculation = calculateQuoteTotals(draft);
  const amountsByLine = new Map(calculation.lines.map((line) => [line.lineId, line]));
  const showTax = draft.meta.taxMode !== "tax-exempt";

  const columns = [
    { id: "sequence", label: "序号", align: "center", width: "5%" },
    { id: "item", label: "商品名称", align: "left", width: "17%" },
    { id: "specification", label: "规格型号", align: "left", width: "13%" },
    { id: "quantity", label: "数量", align: "right", width: "8%" },
    { id: "unit-price", label: "单价", align: "right", width: "11%" },
    { id: "discount", label: "折扣", align: "right", width: "8%" },
    ...(showTax
      ? [
          { id: "tax-rate", label: "税率", align: "right", width: "7%" },
          { id: "subtotal", label: "未税金额", align: "right", width: "11%" },
          { id: "tax", label: "税额", align: "right", width: "9%" },
        ]
      : [{ id: "subtotal", label: "金额", align: "right", width: "27%" }]),
    { id: "total", label: "合计", align: "right", width: "11%" },
  ];

  const rows = draft.lineItems.map((line, index) => {
    const amounts = amountsByLine.get(line.id);
    if (!amounts) {
      throw new Error(`Missing calculated amounts for line ${line.id}`);
    }
    const itemDetails = [line.sku, line.specification, line.description]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n");
    const cells: Record<string, string> = {
      sequence: String(index + 1),
      item: line.name,
      specification: itemDetails || "—",
      quantity: `${line.quantity} ${line.unit}`,
      "unit-price": formatMoneyMinor(line.unitPriceMinor, draft.meta.currency),
      discount: formatBasisPoints(line.discountBps),
      subtotal: formatMoneyMinor(amounts.subtotalMinor, draft.meta.currency),
      total: formatMoneyMinor(amounts.totalMinor, draft.meta.currency),
    };
    if (showTax) {
      cells["tax-rate"] = formatBasisPoints(line.taxRateBps);
      cells.tax = formatMoneyMinor(amounts.taxMinor, draft.meta.currency);
    }
    return { id: line.id, cells };
  });

  const terms = [
    { id: "delivery", label: "交货条款", value: draft.terms.delivery },
    { id: "payment", label: "付款条款", value: draft.terms.payment },
    { id: "quality", label: "质量与检验", value: draft.terms.quality },
    { id: "warranty", label: "质保条款", value: draft.terms.warranty },
    { id: "notes", label: "备注", value: draft.terms.notes },
  ].filter((entry): entry is { id: string; label: string; value: string } =>
    Boolean(entry.value?.trim()),
  );

  const nodes: unknown[] = [
    { type: "heading", id: "title", level: 1, text: "标准货物报价单" },
    {
      type: "metadata",
      id: "quotation-meta",
      entries: [
        { id: "quote-number", label: "报价编号", value: draft.meta.number },
        { id: "issue-date", label: "报价日期", value: draft.meta.issueDate },
        { id: "valid-until", label: "有效期至", value: draft.meta.validUntil },
        { id: "currency", label: "币种", value: draft.meta.currency },
        { id: "tax-mode", label: "税制", value: taxModeLabel(draft.meta.taxMode) },
      ],
    },
    {
      type: "parties",
      id: "parties",
      parties: [
        {
          role: "seller",
          label: "报价方",
          name: draft.seller.name,
          details: partyDetails(draft.seller),
        },
        {
          role: "buyer",
          label: "采购方",
          name: draft.buyer.name,
          details: partyDetails(draft.buyer),
        },
      ],
    },
    {
      type: "table",
      id: "line-items",
      columns,
      rows,
      repeatHeader: true,
      pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
    },
    {
      type: "totals",
      id: "totals",
      entries: [
        {
          id: "gross",
          label: "商品金额",
          value: formatMoneyMinor(calculation.summary.grossMinor, draft.meta.currency),
        },
        {
          id: "discount",
          label: "折扣金额",
          value: formatMoneyMinor(calculation.summary.discountMinor, draft.meta.currency),
        },
        {
          id: "subtotal",
          label: "未税小计",
          value: formatMoneyMinor(calculation.summary.subtotalMinor, draft.meta.currency),
        },
        {
          id: "tax",
          label: "税额",
          value: formatMoneyMinor(calculation.summary.taxMinor, draft.meta.currency),
        },
        {
          id: "total",
          label: "价税合计",
          value: formatMoneyMinor(calculation.summary.totalMinor, draft.meta.currency),
        },
      ],
    },
  ];

  if (terms.length > 0) {
    nodes.push({ type: "terms", id: "terms", entries: terms });
  }

  nodes.push(
    {
      type: "notice",
      id: "notice",
      paragraphs: [
        quoteNatureNotice(draft.meta.quoteNature),
        "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。",
      ],
    },
    {
      type: "signature",
      id: "signature",
      signerLabel: "报价方签署/盖章",
      dateLabel: "签署日期",
    },
  );

  return DocumentModelSchema.parse({
    schemaVersion: "1.0.0",
    documentId: draft.id,
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    locale: draft.meta.language,
    page: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    nodes,
  });
}
