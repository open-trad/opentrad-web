import { describe, expect, it } from "vitest";
import type { DocumentModel, StandardGoodsQuoteDraft } from "../src/index";
import * as core from "../src/index";

interface SchemaLike {
  safeParse(input: unknown): { success: boolean; data?: unknown };
}

interface CompositeCase {
  input: unknown;
  name: string;
  pollutedKey: string;
  schema: SchemaLike;
}

function draft(): StandardGoodsQuoteDraft {
  const input = core.createStandardGoodsQuoteDraft({
    id: "safe-output-quote",
    now: "2026-08-19T12:00:00.000Z",
  });
  input.terms.delivery = "收到订单后 20 天。";
  return input;
}

function modelNode(model: DocumentModel, type: DocumentModel["nodes"][number]["type"]): unknown {
  const found = model.nodes.find((node) => node.type === type);
  if (!found) {
    throw new Error(`Missing ${type} fixture node`);
  }
  return found;
}

function compositeCases(): CompositeCase[] {
  const input = draft();
  const line = input.lineItems[0];
  if (!line) {
    throw new Error("Expected a line item fixture");
  }
  const calculation = core.calculateQuoteTotals(input);
  const calculatedLine = calculation.lines[0];
  if (!calculatedLine) {
    throw new Error("Expected a calculated line fixture");
  }
  const model = core.compileStandardGoodsQuote(input);
  const table = modelNode(model, "table");
  const project = core.parseProject(core.serializeProject(input));

  return [
    {
      name: "TemplateDefinitionSchema",
      schema: core.TemplateDefinitionSchema,
      input: core.STANDARD_GOODS_QUOTE_TEMPLATE,
      pollutedKey: "id",
    },
    { name: "PartySchema", schema: core.PartySchema, input: input.seller, pollutedKey: "name" },
    { name: "LineItemSchema", schema: core.LineItemSchema, input: line, pollutedKey: "id" },
    {
      name: "StandardGoodsQuoteMetaSchema",
      schema: core.StandardGoodsQuoteMetaSchema,
      input: input.meta,
      pollutedKey: "number",
    },
    {
      name: "StandardGoodsQuoteTermsSchema",
      schema: core.StandardGoodsQuoteTermsSchema,
      input: input.terms,
      pollutedKey: "delivery",
    },
    {
      name: "StandardGoodsQuoteDraftSchema",
      schema: core.StandardGoodsQuoteDraftSchema,
      input,
      pollutedKey: "seller",
    },
    { name: "DocumentDraftSchema", schema: core.DocumentDraftSchema, input, pollutedKey: "seller" },
    {
      name: "CalculatedLineAmountsSchema",
      schema: core.CalculatedLineAmountsSchema,
      input: calculatedLine,
      pollutedKey: "lineId",
    },
    {
      name: "CalculatedSummarySchema",
      schema: core.CalculatedSummarySchema,
      input: calculation.summary,
      pollutedKey: "grossMinor",
    },
    {
      name: "QuoteCalculationSchema",
      schema: core.QuoteCalculationSchema,
      input: calculation,
      pollutedKey: "summary",
    },
    {
      name: "DocumentHeadingNodeSchema",
      schema: core.DocumentHeadingNodeSchema,
      input: modelNode(model, "heading"),
      pollutedKey: "text",
    },
    {
      name: "DocumentMetadataNodeSchema",
      schema: core.DocumentMetadataNodeSchema,
      input: modelNode(model, "metadata"),
      pollutedKey: "entries",
    },
    {
      name: "DocumentPartiesNodeSchema",
      schema: core.DocumentPartiesNodeSchema,
      input: modelNode(model, "parties"),
      pollutedKey: "parties",
    },
    {
      name: "DocumentTableNodeSchema",
      schema: core.DocumentTableNodeSchema,
      input: table,
      pollutedKey: "columns",
    },
    {
      name: "DocumentTotalsNodeSchema",
      schema: core.DocumentTotalsNodeSchema,
      input: modelNode(model, "totals"),
      pollutedKey: "entries",
    },
    {
      name: "DocumentTermsNodeSchema",
      schema: core.DocumentTermsNodeSchema,
      input: modelNode(model, "terms"),
      pollutedKey: "entries",
    },
    {
      name: "DocumentNoticeNodeSchema",
      schema: core.DocumentNoticeNodeSchema,
      input: modelNode(model, "notice"),
      pollutedKey: "paragraphs",
    },
    {
      name: "DocumentSignatureNodeSchema",
      schema: core.DocumentSignatureNodeSchema,
      input: modelNode(model, "signature"),
      pollutedKey: "signerLabel",
    },
    {
      name: "DocumentNodeSchema",
      schema: core.DocumentNodeSchema,
      input: table,
      pollutedKey: "columns",
    },
    {
      name: "DocumentModelSchema",
      schema: core.DocumentModelSchema,
      input: model,
      pollutedKey: "nodes",
    },
    {
      name: "RiskFindingSchema",
      schema: core.RiskFindingSchema,
      input: {
        code: "late-payment",
        severity: "warning",
        message: "付款期限较长。",
        path: ["terms"],
      },
      pollutedKey: "severity",
    },
    {
      name: "ProjectEnvelopeSchema",
      schema: core.ProjectEnvelopeSchema,
      input: project,
      pollutedKey: "draft",
    },
  ];
}

function expectOwnOutputShape(actual: unknown, expected: unknown, path = "output"): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    if (!Array.isArray(actual)) {
      return;
    }
    expect(actual, path).toHaveLength(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      expect(Object.hasOwn(actual, index), `${path}.${index}`).toBe(true);
      expectOwnOutputShape(actual[index], expected[index], `${path}.${index}`);
    }
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect(actual, path).toEqual(expected);
    return;
  }

  expect(actual !== null && typeof actual === "object", path).toBe(true);
  if (actual === null || typeof actual !== "object") {
    return;
  }
  expect(Object.getPrototypeOf(actual), `${path} prototype`).toBeNull();
  for (const key of Object.keys(expected)) {
    expect(Object.hasOwn(actual, key), `${path}.${key}`).toBe(true);
    const descriptor = Reflect.getOwnPropertyDescriptor(actual, key);
    expect(descriptor && "value" in descriptor, `${path}.${key} data property`).toBe(true);
    expectOwnOutputShape(
      descriptor && "value" in descriptor ? descriptor.value : undefined,
      Reflect.getOwnPropertyDescriptor(expected, key)?.value,
      `${path}.${key}`,
    );
  }
}

function restorePrototypeProperty(key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(Object.prototype, key, descriptor);
  } else {
    Reflect.deleteProperty(Object.prototype, key);
  }
}

describe("prototype-isolated validated outputs", () => {
  it.each(compositeCases())(
    "$name ignores an inherited getter/setter and returns complete own data",
    ({ input, pollutedKey, schema }) => {
      const original = Reflect.getOwnPropertyDescriptor(Object.prototype, pollutedKey);
      let setterCalls = 0;
      Object.defineProperty(Object.prototype, pollutedKey, {
        configurable: true,
        get() {
          return "PWNED";
        },
        set() {
          setterCalls += 1;
        },
      });

      let result: ReturnType<SchemaLike["safeParse"]> | undefined;
      try {
        expect(() => {
          result = schema.safeParse(input);
        }).not.toThrow();
        expect(result?.success).toBe(true);
        expect(setterCalls).toBe(0);
        if (result?.success) {
          expect(Object.hasOwn(result.data as object, pollutedKey)).toBe(true);
          expectOwnOutputShape(result.data, input);
        }
      } finally {
        restorePrototypeProperty(pollutedKey, original);
      }
    },
  );

  it.each(compositeCases())(
    "$name ignores an inherited non-writable property and does not throw",
    ({ input, pollutedKey, schema }) => {
      const original = Reflect.getOwnPropertyDescriptor(Object.prototype, pollutedKey);
      Object.defineProperty(Object.prototype, pollutedKey, {
        configurable: true,
        enumerable: false,
        value: "PWNED",
        writable: false,
      });

      let result: ReturnType<SchemaLike["safeParse"]> | undefined;
      try {
        expect(() => {
          result = schema.safeParse(input);
        }).not.toThrow();
        expect(result?.success).toBe(true);
        if (result?.success) {
          expect(Object.hasOwn(result.data as object, pollutedKey)).toBe(true);
          expectOwnOutputShape(result.data, input);
        }
      } finally {
        restorePrototypeProperty(pollutedKey, original);
      }
    },
  );

  it("keeps parse, calculation, compilation, and project roundtrip correct under pollution", () => {
    const input = draft();
    const expectedSeller = input.seller;
    const original = Reflect.getOwnPropertyDescriptor(Object.prototype, "seller");
    let setterCalls = 0;
    Object.defineProperty(Object.prototype, "seller", {
      configurable: true,
      get() {
        return "PWNED";
      },
      set() {
        setterCalls += 1;
      },
    });

    try {
      const parsed = core.parseDocumentDraft(input);
      const calculation = core.calculateQuoteTotals(input);
      const model = core.compileStandardGoodsQuote(input);
      const project = core.parseProject(core.serializeProject(input));

      expect(setterCalls).toBe(0);
      expect(Object.hasOwn(parsed, "seller")).toBe(true);
      expect(parsed.seller).toEqual(expectedSeller);
      expect(calculation.lines).toHaveLength(1);
      expect(model.nodes.length).toBeGreaterThan(0);
      expect(Object.hasOwn(project.draft, "seller")).toBe(true);
      expect(project.draft.seller).toEqual(expectedSeller);
    } finally {
      restorePrototypeProperty("seller", original);
    }
  });

  it.each(["tax", "tax-rate"])(
    "compiler defines the conditional %s cell without inherited assignment",
    (pollutedKey) => {
      const input = draft();
      const original = Reflect.getOwnPropertyDescriptor(Object.prototype, pollutedKey);
      let setterCalls = 0;
      Object.defineProperty(Object.prototype, pollutedKey, {
        configurable: true,
        get() {
          return "PWNED";
        },
        set() {
          setterCalls += 1;
        },
      });

      try {
        const model = core.compileStandardGoodsQuote(input);
        const table = model.nodes.find((node) => node.type === "table");
        if (!table || table.type !== "table") {
          throw new Error("Expected compiled table");
        }
        expect(setterCalls).toBe(0);
        expect(Object.hasOwn(table.rows[0]?.cells ?? {}, pollutedKey)).toBe(true);
      } finally {
        restorePrototypeProperty(pollutedKey, original);
      }
    },
  );

  it.each(["tax", "tax-rate"])(
    "compiler ignores an inherited non-writable %s cell",
    (pollutedKey) => {
      const input = draft();
      const original = Reflect.getOwnPropertyDescriptor(Object.prototype, pollutedKey);
      Object.defineProperty(Object.prototype, pollutedKey, {
        configurable: true,
        value: "PWNED",
        writable: false,
      });

      try {
        expect(() => core.compileStandardGoodsQuote(input)).not.toThrow();
      } finally {
        restorePrototypeProperty(pollutedKey, original);
      }
    },
  );

  it("defines snapshotted array indices without invoking Object.prototype setters", () => {
    const input = draft();
    const original = Reflect.getOwnPropertyDescriptor(Object.prototype, "0");
    let setterCalls = 0;
    let result: ReturnType<typeof core.DocumentDraftSchema.safeParse> | undefined;
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      get() {
        return "PWNED";
      },
      set() {
        setterCalls += 1;
      },
    });

    try {
      result = core.DocumentDraftSchema.safeParse(input);
    } finally {
      restorePrototypeProperty("0", original);
    }

    expect(setterCalls).toBe(0);
    expect(result?.success).toBe(true);
    if (result?.success) {
      expect(Object.hasOwn(result.data.lineItems, 0)).toBe(true);
    }
  });

  it("ignores a non-writable Object.prototype array index", () => {
    const input = draft();
    const original = Reflect.getOwnPropertyDescriptor(Object.prototype, "0");
    let result: ReturnType<typeof core.DocumentDraftSchema.safeParse> | undefined;
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      value: "PWNED",
      writable: false,
    });

    try {
      expect(() => {
        result = core.DocumentDraftSchema.safeParse(input);
      }).not.toThrow();
    } finally {
      restorePrototypeProperty("0", original);
    }

    expect(result?.success).toBe(true);
  });

  it("compiler appends optional nodes without inherited array-index assignment", () => {
    const input = draft();
    const original = Reflect.getOwnPropertyDescriptor(Object.prototype, "5");
    let setterCalls = 0;
    Object.defineProperty(Object.prototype, "5", {
      configurable: true,
      get() {
        return "PWNED";
      },
      set() {
        setterCalls += 1;
      },
    });

    let model: DocumentModel | undefined;
    try {
      model = core.compileStandardGoodsQuote(input);
    } finally {
      restorePrototypeProperty("5", original);
    }

    expect(setterCalls).toBe(0);
    expect(model?.nodes.some((node) => node.type === "terms")).toBe(true);
  });

  it("compiler ignores a non-writable inherited node index", () => {
    const input = draft();
    const original = Reflect.getOwnPropertyDescriptor(Object.prototype, "6");
    Object.defineProperty(Object.prototype, "6", {
      configurable: true,
      value: "PWNED",
      writable: false,
    });

    let model: DocumentModel | undefined;
    try {
      expect(() => {
        model = core.compileStandardGoodsQuote(input);
      }).not.toThrow();
    } finally {
      restorePrototypeProperty("6", original);
    }

    expect(model?.nodes.some((node) => node.type === "notice")).toBe(true);
  });
});

describe("public schema no-throw contract", () => {
  it("returns a failed safeParse for a revoked Proxy on every exported schema", () => {
    const schemas = Object.entries(core as unknown as Record<string, unknown>)
      .filter((entry): entry is [string, SchemaLike] => {
        const [name, value] = entry;
        return (
          name.endsWith("Schema") &&
          value !== null &&
          typeof value === "object" &&
          "safeParse" in value &&
          typeof value.safeParse === "function"
        );
      })
      .sort(([left], [right]) => left.localeCompare(right));
    expect(schemas.map(([name]) => name)).toEqual([
      "BasisPointsSchema",
      "CalculatedLineAmountsSchema",
      "CalculatedMoneyMinorSchema",
      "CalculatedSummarySchema",
      "CurrencySchema",
      "DateSchema",
      "DocumentDraftSchema",
      "DocumentHeadingNodeSchema",
      "DocumentMetadataNodeSchema",
      "DocumentModelSchema",
      "DocumentNodeSchema",
      "DocumentNoticeNodeSchema",
      "DocumentPartiesNodeSchema",
      "DocumentSignatureNodeSchema",
      "DocumentTableNodeSchema",
      "DocumentTermsNodeSchema",
      "DocumentTotalsNodeSchema",
      "LineItemSchema",
      "MoneyMinorSchema",
      "PartySchema",
      "ProjectEnvelopeSchema",
      "QuantitySchema",
      "QuoteCalculationSchema",
      "QuoteNatureSchema",
      "RiskFindingSchema",
      "StandardGoodsQuoteDraftSchema",
      "StandardGoodsQuoteMetaSchema",
      "StandardGoodsQuoteTermsSchema",
      "TaxModeSchema",
      "TemplateDefinitionSchema",
    ]);

    for (const [name, schema] of schemas) {
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      let result: ReturnType<SchemaLike["safeParse"]> | undefined;
      expect(() => {
        result = schema.safeParse(revocable.proxy);
      }, name).not.toThrow();
      expect(result?.success, name).toBe(false);
    }
  });
});
