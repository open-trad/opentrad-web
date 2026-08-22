import { describe, expect, it } from "vitest";
import type { OpenTradProjectEnvelope, StandardGoodsQuoteDraft } from "../src/index";
import * as coreModule from "../src/index";

const core = coreModule as Record<string, unknown>;

function firstItem<T>(items: T[]): T {
  const item = items[0];
  if (!item) {
    throw new Error("Expected the fixture array to contain one item");
  }
  return item;
}

function draft(): StandardGoodsQuoteDraft {
  const input = coreModule.createStandardGoodsQuoteDraft({
    id: "project-quote",
    now: "2026-08-19T11:00:00.000Z",
  });
  input.seller.name = "宁波义星科技有限公司";
  input.buyer.name = "上海采购有限公司";
  input.terms.delivery = "收到预付款后 20 天。\n交付地点：上海港。";
  input.lineItems[0] = {
    ...firstItem(input.lineItems),
    name: "真空泵",
    unitPriceMinor: "10000",
    quantity: "2",
    discountBps: 500,
    taxRateBps: 1300,
  };
  return input;
}

function serialize(input: unknown): string {
  const serializer = core.serializeProject as (draft: unknown) => string;
  return serializer(input);
}

function parse(input: string): OpenTradProjectEnvelope {
  const parser = core.parseProject as (serialized: string) => OpenTradProjectEnvelope;
  return parser(input);
}

function projectObject(): Record<string, unknown> {
  return JSON.parse(serialize(draft())) as Record<string, unknown>;
}

describe(".opentrad project envelope", () => {
  it("serializes deterministically and round-trips every validated user field", () => {
    const input = draft();
    const first = serialize(input);
    const second = serialize(input);
    const envelope = parse(first);

    expect(first).toBe(second);
    expect(envelope).toMatchObject({
      formatVersion: "1.0.0",
      templateId: "quotation.goods.standard.v1",
      templateVersion: "1.0.0",
      draft: input,
    });
    expect(envelope.draft.terms.delivery).toBe("收到预付款后 20 天。\n交付地点：上海港。");
    expect(coreModule.ProjectEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("recomputes and replaces tampered derived amounts", () => {
    const payload = projectObject() as {
      calculation: {
        lines: Array<Record<string, string>>;
        summary: Record<string, string>;
      };
    };
    firstItem(payload.calculation.lines).totalMinor = "999999999999";
    payload.calculation.summary.totalMinor = "999999999999";

    const parsed = parse(JSON.stringify(payload));
    expect(parsed.calculation.lines[0]?.totalMinor).toBe("21470");
    expect(parsed.calculation.summary.totalMinor).toBe("21470");
  });

  it.each([
    ["formatVersion", "2.0.0"],
    ["templateId", "quotation.goods.unknown.v1"],
    ["templateVersion", "2.0.0"],
  ])("rejects an unknown envelope %s", (key, value) => {
    const payload = projectObject();
    payload[key] = value;
    expect(() => parse(JSON.stringify(payload))).toThrow();
  });

  it("rejects an unknown version inside the nested draft", () => {
    const payload = projectObject() as { draft: Record<string, unknown> };
    payload.draft.templateVersion = "2.0.0";
    expect(() => parse(JSON.stringify(payload))).toThrow();
  });

  it("rejects 101 imported line items", () => {
    const payload = projectObject() as {
      draft: { lineItems: Array<Record<string, unknown>> };
    };
    const first = firstItem(payload.draft.lineItems);
    payload.draft.lineItems = Array.from({ length: 101 }, (_, index) => ({
      ...first,
      id: `imported-line-${index + 1}`,
    }));
    expect(() => parse(JSON.stringify(payload))).toThrow();
  });

  it("rejects UTF-8 project payloads larger than 1 MiB", () => {
    const oversized = `{"padding":"${"汉".repeat(400_000)}"}`;
    expect(oversized.length).toBeLessThan(1_048_576);
    expect(() => parse(oversized)).toThrow(/1 MiB/);
  });

  it("rejects excessive object depth even when hidden in an unknown field", () => {
    const payload = projectObject();
    let nested: Record<string, unknown> = {};
    payload.extra = nested;
    for (let index = 0; index < 20; index += 1) {
      const next: Record<string, unknown> = {};
      nested.value = next;
      nested = next;
    }
    expect(() => parse(JSON.stringify(payload))).toThrow(/depth/);
  });

  it("rejects overlong strings before unknown fields can be stripped", () => {
    const payload = projectObject();
    payload.extra = "x".repeat(20_000);
    expect(() => parse(JSON.stringify(payload))).toThrow(/string/i);
  });

  it("rejects objects with more than 200 own keys", () => {
    const payload = projectObject();
    payload.extra = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`key-${index}`, index]),
    );
    expect(() => parse(JSON.stringify(payload))).toThrow(/200 keys/);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the dangerous own key %s without polluting prototypes",
    (key) => {
      const serialized = serialize(draft());
      const malicious = serialized.replace("{", `{"${key}":{"polluted":true},`);
      expect(() => parse(malicious)).toThrow(/dangerous key/);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    },
  );

  it("rejects imported HTML and invalid JSON rather than executing or preserving it", () => {
    const payload = projectObject() as {
      draft: { terms: { notes?: string } };
    };
    payload.draft.terms.notes = "<img src=x onerror=alert(1)>";
    expect(() => parse(JSON.stringify(payload))).toThrow();
    expect(() => parse("not-json")).toThrow();
  });
});
