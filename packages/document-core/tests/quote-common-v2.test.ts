import { describe, expect, it } from "vitest";
import {
  calculateQuoteTotals,
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
} from "../src/index";
import {
  BASIS_POINTS_V2_MAX,
  BasisPointsV2Schema,
  CalculableLinesV2Schema,
  CalculableLineV2Schema,
  CalculatedMoneyMinorV2Schema,
  CurrencyV2Schema,
  calculateProformaAdjustmentsV2,
  calculateQuoteLinesV2,
  DateV2Schema,
  DimensionCmV2Schema,
  formatMoneyMinorV2,
  GoodsLinesV2Schema,
  GoodsLineV2Schema,
  HsCodeUserSuppliedV2Schema,
  INCOTERMS_2020_RULES,
  IncotermsRuleV2Schema,
  MoneyMinorV2Schema,
  PartyV2Schema,
  ProformaAdjustmentsInputV2Schema,
  ProformaAdjustmentsV2Schema,
  QuantityV2Schema,
  QuoteCalculationV2Schema,
  QuoteMetaV2Schema,
  ServiceLinesV2Schema,
  ServiceLineV2Schema,
  TaxModeV2Schema,
  WeightKgV2Schema,
} from "../src/v2/index";

function quoteMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: "SQ-20260820-001",
    title: "项目服务报价",
    issueDate: "2026-08-20",
    validUntil: "2026-09-20",
    currency: "CNY",
    taxMode: "tax-excluded",
    quoteNature: "invitation",
    language: "zh-CN",
    layoutStyleId: "modern-business.v1",
    ...overrides,
  };
}

function goodsLine(id = "goods-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "精密连接器",
    unit: "件",
    quantity: "2.5",
    unitPriceMinor: "1999",
    discountBps: 500,
    taxRateBps: 1300,
    ...overrides,
  };
}

function serviceLine(id = "service-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    serviceName: "实施服务",
    deliverable: "验收报告",
    unit: "项",
    quantity: "1",
    unitPriceMinor: "800000",
    discountBps: 0,
    taxRateBps: 600,
    ...overrides,
  };
}

function calculableLine(id = "line-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    quantity: "2.5",
    unitPriceMinor: "1999",
    discountBps: 500,
    taxRateBps: 1300,
    ...overrides,
  };
}

function expectDeepSafeOutput(value: unknown, path = "output"): void {
  if (value === null || typeof value !== "object") return;

  expect(Object.isFrozen(value), `${path} frozen`).toBe(true);
  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value), `${path} array prototype`).toBe(Array.prototype);
  } else {
    expect(Object.getPrototypeOf(value), `${path} object prototype`).toBeNull();
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    expect(descriptor && "value" in descriptor, `${path}.${String(key)} data property`).toBe(true);
    if (descriptor && "value" in descriptor) {
      expectDeepSafeOutput(descriptor.value, `${path}.${String(key)}`);
    }
  }
}

interface SchemaLike {
  safeParse(input: unknown): { success: boolean; data?: unknown };
}

function reachableSchemas(root: object): SchemaLike[] {
  const schemas: SchemaLike[] = [];
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  let visitedCount = 0;

  while (pending.length > 0 && visitedCount < 200) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    visitedCount += 1;

    if (current !== root && "safeParse" in current && typeof current.safeParse === "function") {
      schemas.push(current as SchemaLike);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const child = descriptor.value;
      if ((typeof child === "object" && child !== null) || typeof child === "function") {
        pending.push(child as object);
      }
    }
  }
  return schemas;
}

describe("V2 quotation scalar boundaries", () => {
  it("accepts real leap days and rejects impossible or malformed dates", () => {
    expect(DateV2Schema.safeParse("2028-02-29").success).toBe(true);
    expect(DateV2Schema.safeParse("2027-02-29").success).toBe(false);
    expect(DateV2Schema.safeParse("2028-2-29").success).toBe(false);
  });

  it("locks currency, tax, basis-point, quantity, and money representations", () => {
    expect(["CNY", "USD", "EUR"].every((value) => CurrencyV2Schema.safeParse(value).success)).toBe(
      true,
    );
    expect(CurrencyV2Schema.safeParse("JPY").success).toBe(false);
    expect(
      ["tax-excluded", "tax-included", "tax-exempt"].every(
        (value) => TaxModeV2Schema.safeParse(value).success,
      ),
    ).toBe(true);
    expect(BASIS_POINTS_V2_MAX).toBe(10_000);
    expect(BasisPointsV2Schema.safeParse(0).success).toBe(true);
    expect(BasisPointsV2Schema.safeParse(10_000).success).toBe(true);
    expect(BasisPointsV2Schema.safeParse(10_001).success).toBe(false);
    expect(BasisPointsV2Schema.safeParse("100").success).toBe(false);
    expect(QuantityV2Schema.safeParse("0.000001").success).toBe(true);
    expect(QuantityV2Schema.safeParse("999999999999.999999").success).toBe(true);
    for (const invalid of ["0", "00.1", "1.", ".1", "1e3", "-1", "1000000000000"]) {
      expect(QuantityV2Schema.safeParse(invalid).success, invalid).toBe(false);
    }
    expect(MoneyMinorV2Schema.safeParse("0").success).toBe(true);
    expect(MoneyMinorV2Schema.safeParse("999999999999999999").success).toBe(true);
    for (const invalid of ["00", "1.00", "1e3", "-1", "1000000000000000000"]) {
      expect(MoneyMinorV2Schema.safeParse(invalid).success, invalid).toBe(false);
    }
    expect(CalculatedMoneyMinorV2Schema.safeParse("9".repeat(34)).success).toBe(true);
    expect(CalculatedMoneyMinorV2Schema.safeParse("9".repeat(35)).success).toBe(false);
  });

  it("keeps measurements decimal strings and HS codes user supplied", () => {
    for (const schema of [WeightKgV2Schema, DimensionCmV2Schema]) {
      expect(schema.safeParse("0.001").success).toBe(true);
      expect(schema.safeParse("999999.999").success).toBe(true);
      for (const invalid of ["0", "00.1", "1.0000", "1e3", "-1", 1.25]) {
        expect(schema.safeParse(invalid).success, String(invalid)).toBe(false);
      }
    }
    expect(HsCodeUserSuppliedV2Schema.parse("0101.21-0000")).toBe("0101.21-0000");
    for (const invalid of ["１２３４", "0101/21", "0101A21", "01..01", "1234567890123"]) {
      expect(HsCodeUserSuppliedV2Schema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  it("accepts Unicode text but rejects HTML, XML controls, and lone surrogates", () => {
    expect(GoodsLineV2Schema.safeParse(goodsLine("emoji", { name: "连接器 🧭" })).success).toBe(
      true,
    );
    expect(GoodsLineV2Schema.safeParse(goodsLine("html", { name: "<b>连接器</b>" })).success).toBe(
      false,
    );
    expect(GoodsLineV2Schema.safeParse(goodsLine("xml", { name: "连接\u0001器" })).success).toBe(
      false,
    );
    expect(
      GoodsLineV2Schema.safeParse(goodsLine("surrogate", { name: "连接\ud800器" })).success,
    ).toBe(false);
    expect(
      GoodsLineV2Schema.safeParse(goodsLine("budget", { description: "汉".repeat(20_000) }))
        .success,
    ).toBe(false);
  });
});

describe("V2 shared quotation schemas", () => {
  it("parses strict quote metadata and rejects reversed validity", () => {
    const valid = quoteMeta();
    expect(QuoteMetaV2Schema.parse(valid)).toEqual(valid);
    expect(QuoteMetaV2Schema.safeParse(quoteMeta({ validUntil: "2026-08-19" })).success).toBe(
      false,
    );
    expect(QuoteMetaV2Schema.safeParse(quoteMeta({ quoteNature: "estimate" })).success).toBe(false);
    expect(QuoteMetaV2Schema.safeParse(quoteMeta({ layoutStyleId: "classic" })).success).toBe(
      false,
    );
  });

  it("requires an English title only in bilingual metadata, not on an isolated line", () => {
    expect(QuoteMetaV2Schema.safeParse(quoteMeta({ language: "zh-en" })).success).toBe(false);
    expect(
      QuoteMetaV2Schema.safeParse(
        quoteMeta({ language: "zh-en", englishTitle: "Project Service Quotation" }),
      ).success,
    ).toBe(true);
    expect(GoodsLineV2Schema.safeParse(goodsLine()).success).toBe(true);
    expect(ServiceLineV2Schema.safeParse(serviceLine()).success).toBe(true);
  });

  it("parses strict party, goods, and service fields without deriving customs or tax data", () => {
    const party = {
      legalName: "宁波义星科技有限公司",
      englishName: "Ningbo YiStar Technology Co., Ltd.",
      entityType: "company",
      contactName: "张三",
      email: "sales@example.com",
    };
    expect(PartyV2Schema.parse(party)).toEqual(party);
    expect(PartyV2Schema.safeParse({ ...party, unknown: true }).success).toBe(false);

    const goods = goodsLine("customs", {
      hsCodeUserSupplied: "0101.21-0000",
      netWeightKg: "0.125",
      grossWeightKg: "0.150",
      lengthCm: "10.500",
      widthCm: "5",
      heightCm: "2.25",
    });
    const parsed = GoodsLineV2Schema.parse(goods);
    expect(parsed.hsCodeUserSupplied).toBe("0101.21-0000");
    expect(Object.hasOwn(parsed, "derivedTaxRateBps")).toBe(false);
    expect(
      ServiceLineV2Schema.safeParse(serviceLine("bad", { estimatedHours: "1e3" })).success,
    ).toBe(false);
  });

  it("locks all eleven Incoterms 2020 rule codes", () => {
    expect(INCOTERMS_2020_RULES).toEqual([
      "EXW",
      "FCA",
      "CPT",
      "CIP",
      "DAP",
      "DPU",
      "DDP",
      "FAS",
      "FOB",
      "CFR",
      "CIF",
    ]);
    expect(
      INCOTERMS_2020_RULES.every((rule) => IncotermsRuleV2Schema.safeParse(rule).success),
    ).toBe(true);
    expect(IncotermsRuleV2Schema.safeParse("DAT").success).toBe(false);
    expect(Object.isFrozen(INCOTERMS_2020_RULES)).toBe(true);
  });

  it("enforces 1..100 dense lines with unique stable ids", () => {
    expect(GoodsLinesV2Schema.safeParse([]).success).toBe(false);
    expect(ServiceLinesV2Schema.safeParse([]).success).toBe(false);
    expect(
      GoodsLinesV2Schema.safeParse(Array.from({ length: 100 }, (_, i) => goodsLine(`g-${i}`)))
        .success,
    ).toBe(true);
    expect(
      ServiceLinesV2Schema.safeParse([serviceLine("duplicate"), serviceLine("duplicate")]).success,
    ).toBe(false);
    const sparse = new Array(1);
    expect(GoodsLinesV2Schema.safeParse(sparse).success).toBe(false);
  });

  it("fails an oversized Proxy array before reading an element", () => {
    let numericReads = 0;
    let numericDescriptorReads = 0;
    const oversized = new Proxy(new Array(101), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expect(GoodsLinesV2Schema.safeParse(oversized).success).toBe(false);
    expect(numericReads).toBe(0);
    expect(numericDescriptorReads).toBe(0);
    expect(() =>
      calculateQuoteLinesV2(oversized as never, {
        currency: "CNY",
        taxMode: "tax-excluded",
      }),
    ).toThrow(/100 entries/);
    expect(numericReads).toBe(0);
    expect(numericDescriptorReads).toBe(0);
  });
});

describe("V2 exact quotation money", () => {
  it("calculates gross, discount, subtotal, tax, and total in the required order", () => {
    expect(
      calculateQuoteLinesV2([calculableLine()], {
        currency: "CNY",
        taxMode: "tax-excluded",
      }),
    ).toEqual({
      currency: "CNY",
      taxMode: "tax-excluded",
      lines: [
        {
          lineId: "line-1",
          grossMinor: "4998",
          discountMinor: "250",
          subtotalMinor: "4748",
          taxMinor: "617",
          totalMinor: "5365",
        },
      ],
      summary: {
        grossMinor: "4998",
        discountMinor: "250",
        subtotalMinor: "4748",
        taxMinor: "617",
        totalMinor: "5365",
      },
    });
  });

  it("matches V1 semantics for all three tax modes", () => {
    const line = calculableLine("mode", {
      quantity: "1",
      unitPriceMinor: "11300",
      discountBps: 1000,
      taxRateBps: 1300,
    });
    expect(
      calculateQuoteLinesV2([line], { currency: "USD", taxMode: "tax-excluded" }).lines[0],
    ).toMatchObject({ subtotalMinor: "10170", taxMinor: "1322", totalMinor: "11492" });
    expect(
      calculateQuoteLinesV2([line], { currency: "USD", taxMode: "tax-included" }).lines[0],
    ).toMatchObject({ subtotalMinor: "9000", taxMinor: "1170", totalMinor: "10170" });
    expect(
      calculateQuoteLinesV2([line], { currency: "USD", taxMode: "tax-exempt" }).lines[0],
    ).toMatchObject({ subtotalMinor: "10170", taxMinor: "0", totalMinor: "10170" });
  });

  it("locks half-up at gross, discount, excluded tax, and included-tax split", () => {
    expect(
      calculateQuoteLinesV2(
        [calculableLine("gross", { quantity: "1.005", unitPriceMinor: "100", discountBps: 0 })],
        { currency: "EUR", taxMode: "tax-exempt" },
      ).lines[0]?.grossMinor,
    ).toBe("101");
    expect(
      calculateQuoteLinesV2(
        [
          calculableLine("discount", {
            quantity: "1",
            unitPriceMinor: "1",
            discountBps: 5000,
            taxRateBps: 0,
          }),
        ],
        { currency: "EUR", taxMode: "tax-exempt" },
      ).lines[0]?.discountMinor,
    ).toBe("1");
    expect(
      calculateQuoteLinesV2(
        [
          calculableLine("tax", {
            quantity: "1",
            unitPriceMinor: "1",
            discountBps: 0,
            taxRateBps: 5000,
          }),
        ],
        { currency: "EUR", taxMode: "tax-excluded" },
      ).lines[0]?.taxMinor,
    ).toBe("1");
    expect(
      calculateQuoteLinesV2(
        [
          calculableLine("included", {
            quantity: "1",
            unitPriceMinor: "3",
            discountBps: 0,
            taxRateBps: 10_000,
          }),
        ],
        { currency: "EUR", taxMode: "tax-included" },
      ).lines[0],
    ).toMatchObject({ subtotalMinor: "1", taxMinor: "2", totalMinor: "3" });
  });

  it("allows a full discount without negative amounts", () => {
    expect(
      calculateQuoteLinesV2(
        [calculableLine("free", { unitPriceMinor: "999", discountBps: 10_000 })],
        { currency: "CNY", taxMode: "tax-excluded" },
      ).lines[0],
    ).toMatchObject({
      grossMinor: "2498",
      discountMinor: "2498",
      subtotalMinor: "0",
      taxMinor: "0",
      totalMinor: "0",
    });
  });

  it("keeps maximum bounded products and sums exact beyond safe integers", () => {
    const large = calculableLine("large", {
      quantity: "999999999999",
      unitPriceMinor: "999999999999999999",
      discountBps: 0,
      taxRateBps: 0,
    });
    const result = calculateQuoteLinesV2([large, { ...large, id: "large-2" }], {
      currency: "EUR",
      taxMode: "tax-exempt",
    });
    expect(result.lines[0]?.grossMinor).toBe("999999999998999999000000000001");
    expect(result.summary.totalMinor).toBe("1999999999997999998000000000002");
  });

  it("strictly parses public input and preserves currency and tax mode", () => {
    expect(() =>
      calculateQuoteLinesV2([calculableLine()], {
        currency: "JPY" as "CNY",
        taxMode: "tax-excluded",
      }),
    ).toThrow();
    expect(() =>
      calculateQuoteLinesV2([{ ...calculableLine(), extra: true }] as never, {
        currency: "CNY",
        taxMode: "tax-excluded",
      }),
    ).toThrow();
    expect(() =>
      calculateQuoteLinesV2([calculableLine("same"), calculableLine("same")], {
        currency: "CNY",
        taxMode: "tax-excluded",
      }),
    ).toThrow();
    expect(
      calculateQuoteLinesV2([calculableLine()], {
        currency: "USD",
        taxMode: "tax-included",
      }),
    ).toMatchObject({ currency: "USD", taxMode: "tax-included" });
  });

  it("makes strict calculable-line projection explicit in both TypeScript and runtime", () => {
    const goods = GoodsLineV2Schema.parse(goodsLine());
    const compileOnlyDirectRichLineCall = () => {
      // @ts-expect-error Rich quotation lines must be explicitly projected before calculation.
      calculateQuoteLinesV2([goods], { currency: "CNY", taxMode: "tax-excluded" });
    };
    expect(typeof compileOnlyDirectRichLineCall).toBe("function");
    expect(() =>
      calculateQuoteLinesV2([goods] as never, {
        currency: "CNY",
        taxMode: "tax-excluded",
      }),
    ).toThrow();

    const projected = {
      id: goods.id,
      quantity: goods.quantity,
      unitPriceMinor: goods.unitPriceMinor,
      discountBps: goods.discountBps,
      taxRateBps: goods.taxRateBps,
    };
    expect(
      calculateQuoteLinesV2([projected], {
        currency: "CNY",
        taxMode: "tax-excluded",
      }).lines,
    ).toHaveLength(1);
  });

  it("rejects calculated output with forged line relationships or summaries", () => {
    const valid = calculateQuoteLinesV2([calculableLine()], {
      currency: "CNY",
      taxMode: "tax-excluded",
    });
    expect(
      QuoteCalculationV2Schema.safeParse({
        ...valid,
        summary: { ...valid.summary, totalMinor: "1" },
      }).success,
    ).toBe(false);
    expect(
      QuoteCalculationV2Schema.safeParse({
        ...valid,
        lines: [{ ...valid.lines[0], taxMinor: "0" }],
      }).success,
    ).toBe(false);
  });

  it("formats validated non-negative minor units with ISO currency and two decimals", () => {
    expect(formatMoneyMinorV2("0", "CNY")).toBe("CNY 0.00");
    expect(formatMoneyMinorV2("1234", "USD")).toBe("USD 12.34");
    expect(formatMoneyMinorV2("9007199254740993", "EUR")).toBe("EUR 90,071,992,547,409.93");
    expect(() => formatMoneyMinorV2("1.00", "CNY")).toThrow();
    expect(() => formatMoneyMinorV2("100", "JPY" as "CNY")).toThrow();
  });
});

describe("V2 Pro Forma adjustments", () => {
  it("mechanically applies discount, freight, insurance, and ordered other charges", () => {
    const result = calculateProformaAdjustmentsV2({
      currency: "USD",
      linesTotalMinor: "10000",
      documentDiscountMinor: "1000",
      freightMinor: "500",
      insuranceMinor: "200",
      otherCharges: [
        { id: "handling", label: "Handling", amountMinor: "100" },
        { id: "documents", label: "Documents", amountMinor: "50" },
      ],
    });
    expect(result).toEqual({
      currency: "USD",
      linesTotalMinor: "10000",
      documentDiscountMinor: "1000",
      freightMinor: "500",
      insuranceMinor: "200",
      otherCharges: [
        { id: "handling", label: "Handling", amountMinor: "100" },
        { id: "documents", label: "Documents", amountMinor: "50" },
      ],
      otherChargesMinor: "150",
      totalMinor: "9850",
    });
  });

  it("defaults absent adjustments to zero and never guesses tax", () => {
    const input = { currency: "CNY", linesTotalMinor: "88", otherCharges: [] } as const;
    expect(ProformaAdjustmentsInputV2Schema.parse(input)).toMatchObject({
      documentDiscountMinor: "0",
      freightMinor: "0",
      insuranceMinor: "0",
    });
    expect(calculateProformaAdjustmentsV2(input)).toEqual({
      currency: "CNY",
      linesTotalMinor: "88",
      documentDiscountMinor: "0",
      freightMinor: "0",
      insuranceMinor: "0",
      otherCharges: [],
      otherChargesMinor: "0",
      totalMinor: "88",
    });
    expect(
      ProformaAdjustmentsInputV2Schema.safeParse({ ...input, taxMode: "tax-excluded" }).success,
    ).toBe(false);
  });

  it("rejects discounts beyond line totals, duplicate charges, and unknown fields", () => {
    expect(() =>
      calculateProformaAdjustmentsV2({
        currency: "EUR",
        linesTotalMinor: "10",
        documentDiscountMinor: "11",
        otherCharges: [],
      }),
    ).toThrow();
    expect(
      ProformaAdjustmentsInputV2Schema.safeParse({
        currency: "EUR",
        linesTotalMinor: "10",
        otherCharges: [
          { id: "same", label: "A", amountMinor: "1" },
          { id: "same", label: "B", amountMinor: "2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProformaAdjustmentsInputV2Schema.safeParse({
        currency: "EUR",
        linesTotalMinor: "10",
        otherCharges: [],
        exchangeRate: "7.2",
      }).success,
    ).toBe(false);
  });

  it("rejects line totals outside the calculator's reachable domain before adding charges", () => {
    expect(
      ProformaAdjustmentsInputV2Schema.safeParse({
        currency: "USD",
        linesTotalMinor: "9".repeat(34),
        freightMinor: "1",
        otherCharges: [],
      }).success,
    ).toBe(false);
  });
});

describe("V2 quotation hostile-input and safe-output contract", () => {
  it("turns unknown, dangerous, accessor, symbol, prototype, sparse, cycle, and Proxy inputs into no-throw failures", () => {
    const cases: unknown[] = [];
    cases.push(goodsLine("unknown", { unexpected: true }));

    const dangerous = goodsLine("dangerous");
    Object.defineProperty(dangerous, "constructor", { enumerable: true, value: {} });
    cases.push(dangerous);

    const accessor = goodsLine("accessor");
    let getterCalls = 0;
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "stolen";
      },
    });
    cases.push(accessor);

    const symbol = goodsLine("symbol") as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    cases.push(symbol);
    cases.push(Object.assign(Object.create({ inherited: true }), goodsLine("prototype")));

    const cycle = goodsLine("cycle") as Record<string, unknown>;
    cycle.self = cycle;
    cases.push(cycle);

    cases.push(
      new Proxy(goodsLine("throwing"), {
        ownKeys() {
          throw new Error("malicious ownKeys");
        },
      }),
    );
    const { proxy: revoked, revoke } = Proxy.revocable(goodsLine("revoked"), {});
    revoke();
    cases.push(revoked);

    for (const input of cases) {
      let result: { success: boolean } | undefined;
      expect(() => {
        result = GoodsLineV2Schema.safeParse(input);
      }).not.toThrow();
      expect(result?.success).toBe(false);
    }
    expect(getterCalls).toBe(0);

    const sparse = new Array(1);
    let result: { success: boolean } | undefined;
    expect(() => {
      result = CalculableLinesV2Schema.safeParse(sparse);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("returns null-prototype own-data deeply frozen outputs under prototype pollution", () => {
    const originalCurrency = Reflect.getOwnPropertyDescriptor(Object.prototype, "currency");
    const originalLineId = Reflect.getOwnPropertyDescriptor(Object.prototype, "lineId");
    let setterCalls = 0;
    try {
      for (const key of ["currency", "lineId"]) {
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          get() {
            return "PWNED";
          },
          set() {
            setterCalls += 1;
          },
        });
      }
      const calculation = calculateQuoteLinesV2([calculableLine()], {
        currency: "CNY",
        taxMode: "tax-excluded",
      });
      const adjustment = calculateProformaAdjustmentsV2({
        currency: "CNY",
        linesTotalMinor: calculation.summary.totalMinor,
        otherCharges: [{ id: "fee", label: "手续费", amountMinor: "1" }],
      });
      const parsedLine = GoodsLineV2Schema.parse(goodsLine());

      expect(setterCalls).toBe(0);
      expectDeepSafeOutput(calculation);
      expectDeepSafeOutput(adjustment);
      expectDeepSafeOutput(parsedLine);
      expect(() => {
        (calculation.lines as unknown[]).push({});
      }).toThrow();
    } finally {
      if (originalCurrency) Object.defineProperty(Object.prototype, "currency", originalCurrency);
      else Reflect.deleteProperty(Object.prototype, "currency");
      if (originalLineId) Object.defineProperty(Object.prototype, "lineId", originalLineId);
      else Reflect.deleteProperty(Object.prototype, "lineId");
    }
  });

  it("does not expose a reachable raw schema that bypasses public boundaries", () => {
    for (const schema of [
      QuoteMetaV2Schema,
      GoodsLineV2Schema,
      ServiceLineV2Schema,
      CalculableLineV2Schema,
      QuoteCalculationV2Schema,
      ProformaAdjustmentsInputV2Schema,
      ProformaAdjustmentsV2Schema,
    ]) {
      expect(reachableSchemas(schema)).toEqual([]);
    }
  });
});

describe("V1 quotation regression", () => {
  it("keeps the fixed V1 exact-money vector unchanged", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "quote-common-v2-v1-regression",
      now: "2026-08-20T00:00:00.000Z",
    });
    const line = draft.lineItems[0];
    if (!line) throw new Error("Expected V1 line fixture");
    draft.meta.taxMode = "tax-excluded";
    draft.lineItems[0] = {
      ...line,
      quantity: "2.5",
      unitPriceMinor: "1999",
      discountBps: 500,
      taxRateBps: 1300,
    };
    expect(calculateQuoteTotals(draft as StandardGoodsQuoteDraft).lines[0]).toMatchObject({
      grossMinor: "4998",
      discountMinor: "250",
      subtotalMinor: "4748",
      taxMinor: "617",
      totalMinor: "5365",
    });
  });
});
