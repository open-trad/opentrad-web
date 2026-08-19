import { describe, expect, it } from "vitest";
import type { QuoteCalculation, StandardGoodsQuoteDraft } from "../src/index";
import * as coreModule from "../src/index";

const core = coreModule as Record<string, unknown>;

function draft(): StandardGoodsQuoteDraft {
  return coreModule.createStandardGoodsQuoteDraft({
    id: "money-quote",
    now: "2026-08-19T09:00:00.000Z",
  });
}

function calculate(input: StandardGoodsQuoteDraft): QuoteCalculation {
  const calculateQuoteTotals = core.calculateQuoteTotals as (
    draft: StandardGoodsQuoteDraft,
  ) => QuoteCalculation;
  return calculateQuoteTotals(input);
}

function firstLine(draft: StandardGoodsQuoteDraft) {
  const line = draft.lineItems[0];
  if (!line) {
    throw new Error("Expected the draft fixture to contain one line item");
  }
  return line;
}

describe("exact quotation money calculations", () => {
  it.each([
    ["calculateQuoteTotals", coreModule.calculateQuoteTotals],
    ["compileStandardGoodsQuote", coreModule.compileStandardGoodsQuote],
    ["serializeProject", coreModule.serializeProject],
  ])("%s rejects oversized sparse lines before reading entries", (_name, operation) => {
    const input = draft();
    const sparseLines = new Proxy(new Array(101), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          throw new Error("Oversized line entry was visited");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    input.lineItems = sparseLines as StandardGoodsQuoteDraft["lineItems"];

    expect(() => operation(input)).toThrow(/maximum of 100 line items/);
  });

  it("calculates tax-excluded line and summary amounts after discount", () => {
    const input = draft();
    input.meta.taxMode = "tax-excluded";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "2",
      unitPriceMinor: "5000",
      discountBps: 1000,
      taxRateBps: 1300,
    };

    expect(calculate(input)).toEqual({
      currency: "CNY",
      taxMode: "tax-excluded",
      lines: [
        {
          lineId: firstLine(input).id,
          grossMinor: "10000",
          subtotalMinor: "9000",
          discountMinor: "1000",
          taxMinor: "1170",
          totalMinor: "10170",
        },
      ],
      summary: {
        grossMinor: "10000",
        subtotalMinor: "9000",
        discountMinor: "1000",
        taxMinor: "1170",
        totalMinor: "10170",
      },
    });
  });

  it("backs tax out of tax-included prices after discount", () => {
    const input = draft();
    input.meta.taxMode = "tax-included";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "1",
      unitPriceMinor: "11300",
      discountBps: 1000,
      taxRateBps: 1300,
    };

    expect(calculate(input).lines[0]).toEqual({
      lineId: firstLine(input).id,
      grossMinor: "11300",
      subtotalMinor: "9000",
      discountMinor: "1130",
      taxMinor: "1170",
      totalMinor: "10170",
    });
  });

  it("forces tax to zero for tax-exempt quotes despite stale hidden tax input", () => {
    const input = draft();
    input.meta.taxMode = "tax-exempt";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "3",
      unitPriceMinor: "100",
      discountBps: 2500,
      taxRateBps: 10_000,
    };

    expect(calculate(input).lines[0]).toMatchObject({
      grossMinor: "300",
      discountMinor: "75",
      subtotalMinor: "225",
      taxMinor: "0",
      totalMinor: "225",
    });
  });

  it("allows a full 10000-bps discount without producing negative money", () => {
    const input = draft();
    input.lineItems[0] = {
      ...firstLine(input),
      unitPriceMinor: "999",
      discountBps: 10_000,
      taxRateBps: 1300,
    };

    expect(calculate(input).lines[0]).toMatchObject({
      grossMinor: "999",
      discountMinor: "999",
      subtotalMinor: "0",
      taxMinor: "0",
      totalMinor: "0",
    });
  });

  it("rounds 0.005 currency units half-up to one minor unit", () => {
    const input = draft();
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "1",
      unitPriceMinor: "1",
      discountBps: 0,
      taxRateBps: 5000,
    };

    expect(calculate(input).lines[0]?.taxMinor).toBe("1");
  });

  it("uses exact decimal rationals for the binary-tail case 1.005", () => {
    const input = draft();
    input.meta.taxMode = "tax-exempt";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "1.005",
      unitPriceMinor: "100",
    };

    const result = calculate(input);
    expect(result.lines[0]?.grossMinor).toBe("101");
    expect(result.summary.totalMinor).toBe("101");
  });

  it("keeps integers beyond Number.MAX_SAFE_INTEGER exact", () => {
    const input = draft();
    input.meta.taxMode = "tax-exempt";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "0.3",
      unitPriceMinor: "9007199254740993",
    };

    expect(calculate(input).summary.totalMinor).toBe("2702159776422298");
  });

  it("keeps the maximum bounded input product exact", () => {
    const input = draft();
    input.meta.taxMode = "tax-exempt";
    input.lineItems[0] = {
      ...firstLine(input),
      quantity: "999999999999",
      unitPriceMinor: "999999999999999999",
    };

    expect(calculate(input).summary.totalMinor).toBe("999999999998999999000000000001");
  });
});
