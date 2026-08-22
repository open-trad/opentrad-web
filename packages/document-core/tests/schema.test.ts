import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as coreModule from "../src/index";

const core = coreModule as Record<string, unknown>;

interface SchemaLike {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
}

interface DraftShape {
  id: string;
  templateId: string;
  templateVersion: string;
  meta: {
    number: string;
    issueDate: string;
    validUntil: string;
    currency: string;
    taxMode: string;
    quoteNature: string;
    language: string;
    layout: string;
  };
  seller: Record<string, string>;
  buyer: Record<string, string>;
  lineItems: Array<{
    id: string;
    name: string;
    unit: string;
    quantity: string;
    unitPriceMinor: string;
    discountBps: number;
    taxRateBps: number;
  }>;
  terms: Record<string, string>;
  updatedAt: string;
}

function getSchema(name: string): SchemaLike {
  return core[name] as SchemaLike;
}

function createDraft(overrides: { id?: string; now?: string | Date } = {}): DraftShape {
  const create = core.createStandardGoodsQuoteDraft as (input: {
    id: string;
    now: string | Date;
  }) => DraftShape;
  return create({
    id: overrides.id ?? "quote-001",
    now: overrides.now ?? "2026-08-19T08:30:00.000Z",
  });
}

function firstLine(draft: DraftShape): DraftShape["lineItems"][number] {
  const line = draft.lineItems[0];
  if (!line) {
    throw new Error("Expected the draft fixture to contain one line item");
  }
  return line;
}

describe("standard goods quotation schemas", () => {
  it("enables Zod jitless mode for strict CSP before schemas are used", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("exports the required template and draft schema API", () => {
    expect(core.TemplateDefinitionSchema).toBeDefined();
    expect(core.PartySchema).toBeDefined();
    expect(core.LineItemSchema).toBeDefined();
    expect(core.DocumentDraftSchema).toBeDefined();
    expect(core.DocumentModelSchema).toBeDefined();
    expect(core.RiskFindingSchema).toBeDefined();
    expect(core.ProjectEnvelopeSchema).toBeDefined();
    expect(core.createStandardGoodsQuoteDraft).toBeTypeOf("function");
  });

  it("pins the standard quotation template identity and basis date", () => {
    expect(core.STANDARD_GOODS_QUOTE_TEMPLATE).toEqual({
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      category: "quotation",
      name: "标准货物报价单",
      supportedCurrencies: ["CNY", "USD", "EUR"],
    });
    expect(getSchema("TemplateDefinitionSchema").parse(core.STANDARD_GOODS_QUOTE_TEMPLATE)).toEqual(
      core.STANDARD_GOODS_QUOTE_TEMPLATE,
    );
    expect(Object.isFrozen(core.STANDARD_GOODS_QUOTE_TEMPLATE)).toBe(true);
    expect(
      Object.isFrozen(
        (core.STANDARD_GOODS_QUOTE_TEMPLATE as { supportedCurrencies: unknown })
          .supportedCurrencies,
      ),
    ).toBe(true);
  });

  it("creates a deterministic, schema-valid draft from id and time", () => {
    const first = createDraft();
    const second = createDraft();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: "quote-001",
      templateId: "quotation.goods.standard.v1",
      templateVersion: "1.0.0",
      meta: {
        issueDate: "2026-08-19",
        validUntil: "2026-09-18",
        currency: "CNY",
        taxMode: "tax-excluded",
        quoteNature: "invitation",
        language: "zh-CN",
        layout: "classic",
      },
      updatedAt: "2026-08-19T08:30:00.000Z",
    });
    expect(getSchema("DocumentDraftSchema").safeParse(first).success).toBe(true);
  });

  it("accepts real dates only and requires validity on or after issue date", () => {
    const schema = getSchema("DocumentDraftSchema");
    const sameDay = createDraft();
    sameDay.meta.validUntil = sameDay.meta.issueDate;
    expect(schema.safeParse(sameDay).success).toBe(true);

    const reversed = createDraft();
    reversed.meta.validUntil = "2026-08-18";
    expect(schema.safeParse(reversed).success).toBe(false);

    const impossible = createDraft();
    impossible.meta.issueDate = "2026-02-30";
    expect(schema.safeParse(impossible).success).toBe(false);
  });

  it("rejects impossible updated timestamps and invalid creation times", () => {
    const impossible = createDraft();
    impossible.updatedAt = "2026-02-30T08:30:00.000Z";
    expect(getSchema("DocumentDraftSchema").safeParse(impossible).success).toBe(false);
    expect(() => createDraft({ now: "2026-02-30T08:30:00.000Z" })).toThrow();
  });

  it.each([null, 0, true])("rejects non-date creation time %s at runtime", (now) => {
    const create = core.createStandardGoodsQuoteDraft as (input: unknown) => unknown;
    expect(() => create({ id: "invalid-now", now })).toThrow(TypeError);
  });

  it.each(["0", "1.0000000", "1e2", "01", "-1", "NaN"])(
    "rejects invalid positive quantity decimal %s",
    (quantity) => {
      const draft = createDraft();
      firstLine(draft).quantity = quantity;
      expect(getSchema("DocumentDraftSchema").safeParse(draft).success).toBe(false);
    },
  );

  it("accepts positive quantity decimals with at most six fractional digits", () => {
    const draft = createDraft();
    firstLine(draft).quantity = "0.123456";
    expect(getSchema("DocumentDraftSchema").safeParse(draft).success).toBe(true);
  });

  it.each([-1, 10_001, 1.5])("rejects invalid discount basis points %s", (discountBps) => {
    const draft = createDraft();
    firstLine(draft).discountBps = discountBps;
    expect(getSchema("DocumentDraftSchema").safeParse(draft).success).toBe(false);
  });

  it.each([-1, 10_001, 1.5])("rejects invalid tax basis points %s", (taxRateBps) => {
    const draft = createDraft();
    firstLine(draft).taxRateBps = taxRateBps;
    expect(getSchema("DocumentDraftSchema").safeParse(draft).success).toBe(false);
  });

  it("requires non-blank party names and item name and unit", () => {
    const schema = getSchema("DocumentDraftSchema");
    for (const mutate of [
      (draft: DraftShape) => {
        draft.seller.name = "   ";
      },
      (draft: DraftShape) => {
        draft.buyer.name = "";
      },
      (draft: DraftShape) => {
        firstLine(draft).name = "\n";
      },
      (draft: DraftShape) => {
        firstLine(draft).unit = " ";
      },
    ]) {
      const draft = createDraft();
      mutate(draft);
      expect(schema.safeParse(draft).success).toBe(false);
    }
  });

  it("accepts 100 items and rejects 101 items", () => {
    const schema = getSchema("DocumentDraftSchema");
    const draft = createDraft();
    const initial = firstLine(draft);
    draft.lineItems = Array.from({ length: 100 }, (_, index) => ({
      ...initial,
      id: `line-${index + 1}`,
    }));
    expect(schema.safeParse(draft).success).toBe(true);

    draft.lineItems.push({ ...initial, id: "line-101" });
    expect(schema.safeParse(draft).success).toBe(false);
  });

  it("rejects unknown draft template ids and versions", () => {
    const schema = getSchema("DocumentDraftSchema");
    const wrongTemplate = createDraft();
    wrongTemplate.templateId = "quotation.goods.unknown.v1";
    expect(schema.safeParse(wrongTemplate).success).toBe(false);

    const wrongVersion = createDraft();
    wrongVersion.templateVersion = "2.0.0";
    expect(schema.safeParse(wrongVersion).success).toBe(false);
  });

  it("rejects HTML in user text but preserves Chinese and newlines", () => {
    const schema = getSchema("DocumentDraftSchema");
    const html = createDraft();
    html.terms.notes = "安全文本<script>alert(1)</script>";
    expect(schema.safeParse(html).success).toBe(false);

    const chinese = createDraft();
    chinese.seller.name = "宁波义星科技有限公司";
    chinese.terms.notes = "第一行：价格有效。\n第二行：交期另议。";
    const parsed = schema.parse(chinese) as DraftShape;
    expect(parsed.seller.name).toBe("宁波义星科技有限公司");
    expect(parsed.terms.notes).toBe("第一行：价格有效。\n第二行：交期另议。");
  });
});
