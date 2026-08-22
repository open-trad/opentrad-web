import { createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import {
  buildDraftFromForm,
  draftToFormState,
  normalizeQuantity,
  parseMajorMoneyToMinor,
  parsePercentToBps,
} from "./draftConversion";

describe("quotation editor exact conversions", () => {
  it.each([
    ["1", "100"],
    ["1.05", "105"],
    ["0.01", "1"],
    ["0001.05", "105"],
    ["0", "0"],
  ])("converts major money %s to exact minor units", (input, expected) => {
    expect(parseMajorMoneyToMinor(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "-1", "1.005", "1.", ".5", "10000000000000000", "abc"])(
    "rejects invalid money %s without rounding",
    (input) => {
      expect(parseMajorMoneyToMinor(input)).toEqual({
        ok: false,
        message: "请输入非负金额，最多保留 2 位小数",
      });
    },
  );

  it.each([
    ["13", 1300],
    ["0.05", 5],
    ["100", 10000],
    ["000.50", 50],
  ])("converts percent %s to exact basis points", (input, expected) => {
    expect(parsePercentToBps(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "-1", "1.005", "100.01", "101", ".5", "1."])(
    "rejects invalid percent %s",
    (input) => {
      expect(parsePercentToBps(input)).toEqual({
        ok: false,
        message: "请输入 0 到 100 之间的百分比，最多保留 2 位小数",
      });
    },
  );

  it.each([
    ["1", "1"],
    ["00012.340000", "12.34"],
    ["0.000001", "0.000001"],
    ["999999999999.999999", "999999999999.999999"],
  ])("normalizes valid quantity %s", (input, expected) => {
    expect(normalizeQuantity(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "-1", "0", "0.000000", "1.0000001", "1000000000000", ".5", "1."])(
    "rejects invalid quantity %s",
    (input) => {
      expect(normalizeQuantity(input)).toEqual({
        ok: false,
        message: "请输入大于 0 的数量，整数最多 12 位、小数最多 6 位",
      });
    },
  );

  it("rejects extremely long numeric strings before any BigInt conversion", () => {
    const overlong = "9".repeat(10_000);
    const nativeBigInt = BigInt;
    const bigInt = vi.fn((value: string | number | bigint | boolean) => nativeBigInt(value));
    vi.stubGlobal("BigInt", bigInt);
    try {
      expect(parseMajorMoneyToMinor(overlong).ok).toBe(false);
      expect(parsePercentToBps(overlong).ok).toBe(false);
      expect(normalizeQuantity(overlong).ok).toBe(false);
      expect(bigInt).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("quotation form draft conversion", () => {
  it("round-trips every editable field and converts exact numeric strings", () => {
    const source = createStandardGoodsQuoteDraft({
      id: "draft-form-roundtrip",
      now: "2026-08-19T10:00:00.000Z",
    });
    source.meta.number = "QT-CN-001";
    source.meta.currency = "USD";
    source.meta.taxMode = "tax-included";
    source.meta.quoteNature = "binding-offer";
    source.seller = {
      name: "宁波远航贸易有限公司",
      address: "宁波市海曙区",
      contactName: "林经理",
      phone: "0574-12345678",
      email: "sales@example.cn",
      taxId: "91330200TEST",
      bankName: "中国银行宁波分行",
      bankAccount: "622200001",
    };
    source.buyer = {
      name: "海湾采购集团",
      address: "上海市浦东新区",
      contactName: "周经理",
      phone: "021-12345678",
      email: "buy@example.cn",
      taxId: "91310000TEST",
      bankName: "招商银行上海分行",
      bankAccount: "622200002",
    };
    source.lineItems[0] = {
      id: "line-stable-1",
      name: "工业级节能电机",
      sku: "MOTOR-01",
      specification: "IE4 / 380V",
      description: "出口包装",
      unit: "台",
      quantity: "12.5",
      unitPriceMinor: "123405",
      discountBps: 125,
      taxRateBps: 1300,
    };
    source.terms = {
      delivery: "收到订单后 20 个工作日",
      payment: "30% 预付款",
      quality: "出厂检验",
      warranty: "12 个月",
      notes: "价格包含标准包装",
    };

    const form = draftToFormState(source);
    expect(form.lineItems[0]).toMatchObject({
      id: "line-stable-1",
      quantity: "12.5",
      unitPriceMajor: "1234.05",
      discountPercent: "1.25",
      taxRatePercent: "13",
    });

    const result = buildDraftFromForm(form, "2026-08-19T11:00:00.000Z");
    expect(result).toEqual({
      ok: true,
      draft: { ...source, updatedAt: "2026-08-19T11:00:00.000Z" },
    });
  });

  it("returns linked field errors and never emits a partially valid draft", () => {
    const source = createStandardGoodsQuoteDraft({
      id: "draft-form-invalid",
      now: "2026-08-19T10:00:00.000Z",
    });
    const form = draftToFormState(source);
    form.seller.name = "";
    form.buyer.name = "";
    const firstLine = form.lineItems[0];
    if (!firstLine) throw new Error("Expected the standard form to contain one line");
    firstLine.quantity = "0";
    firstLine.unitPriceMajor = "1.005";
    firstLine.discountPercent = "100.01";

    const result = buildDraftFromForm(form, "2026-08-19T11:00:00.000Z");
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid form result");
    }
    expect(result.errors).toMatchObject({
      "seller.name": "请填写报价方名称",
      "buyer.name": "请填写采购方名称",
      "lineItems.0.quantity": "请输入大于 0 的数量，整数最多 12 位、小数最多 6 位",
      "lineItems.0.unitPriceMajor": "请输入非负金额，最多保留 2 位小数",
      "lineItems.0.discountPercent": "请输入 0 到 100 之间的百分比，最多保留 2 位小数",
    });
    expect("draft" in result).toBe(false);
  });

  it("normalizes every tax rate to zero for tax-exempt drafts", () => {
    const source = createStandardGoodsQuoteDraft({
      id: "draft-form-exempt",
      now: "2026-08-19T10:00:00.000Z",
    });
    const form = draftToFormState(source);
    form.meta.taxMode = "tax-exempt";
    const firstLine = form.lineItems[0];
    if (!firstLine) throw new Error("Expected the standard form to contain one line");
    firstLine.taxRatePercent = "13";
    form.lineItems.push({
      ...firstLine,
      id: "line-stable-2",
      name: "配套控制模块",
      taxRatePercent: "6.5",
    });

    const result = buildDraftFromForm(form, "2026-08-19T11:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected a valid exempt draft");
    }
    expect(result.draft.lineItems.map((line) => line.taxRateBps)).toEqual([0, 0]);
  });
});
