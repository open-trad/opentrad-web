import { describe, expect, it } from "vitest";
import type { DocumentModel, StandardGoodsQuoteDraft } from "../src/index";
import * as core from "../src/index";

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
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    visitedCount += 1;

    if (current !== root && "safeParse" in current && typeof current.safeParse === "function") {
      schemas.push(current as SchemaLike);
    }

    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) {
        continue;
      }
      const child = descriptor.value;
      if ((typeof child === "object" && child !== null) || typeof child === "function") {
        pending.push(child as object);
      }
    }
  }

  return schemas;
}

function draft(): StandardGoodsQuoteDraft {
  return core.createStandardGoodsQuoteDraft({
    id: "boundary-quote",
    now: "2026-08-19T12:00:00.000Z",
  });
}

function firstLine(input: StandardGoodsQuoteDraft) {
  const line = input.lineItems[0];
  if (!line) {
    throw new Error("Expected the draft fixture to contain one line item");
  }
  return line;
}

function unreadSparseArray(length: number) {
  let numericReads = 0;
  const value = new Proxy(new Array(length), {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        numericReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { value, numericReads: () => numericReads };
}

function descriptorObservedDenseArray(length: number) {
  let numericDescriptorReads = 0;
  const value = new Proxy(
    Array.from({ length }, () => "value"),
    {
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          numericDescriptorReads += 1;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  return { value, numericDescriptorReads: () => numericDescriptorReads };
}

function fullModel(): DocumentModel {
  const input = draft();
  input.terms.delivery = "收到订单后 20 天。";
  return core.compileStandardGoodsQuote(input);
}

function modelNode(type: DocumentModel["nodes"][number]["type"]): Record<string, unknown> {
  const found = fullModel().nodes.find((node) => node.type === type);
  if (!found) {
    throw new Error(`Missing ${type} fixture node`);
  }
  return found as Record<string, unknown>;
}

describe("bounded public composite schemas", () => {
  it("does not iterate an oversized sparse line array through the public draft schema", () => {
    const input = draft();
    const sparse = unreadSparseArray(101);
    input.lineItems = sparse.value as StandardGoodsQuoteDraft["lineItems"];

    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);
    expect(sparse.numericReads()).toBe(0);
  });

  it("snapshots a stateful array once so it cannot expand during Zod parsing", () => {
    const input = draft();
    const line = firstLine(input);
    let lengthReads = 0;
    let numericReads = 0;
    const statefulLines = new Proxy([line], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 101;
        }
        if (typeof property === "string" && /^\d+$/.test(property)) {
          numericReads += 1;
          return line;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    input.lineItems = statefulLines;

    const result = core.DocumentDraftSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lineItems).toHaveLength(1);
    }
    expect(lengthReads).toBe(0);
    expect(numericReads).toBe(0);
  });

  it("rejects an inherited-only draft", () => {
    const inheritedDraft = Object.create(draft()) as unknown;
    expect(core.DocumentDraftSchema.safeParse(inheritedDraft).success).toBe(false);
  });

  it("does not expose a reachable raw schema that bypasses the input boundary", () => {
    const inheritedDraft = Object.create(draft()) as unknown;
    const reachable = reachableSchemas(core.DocumentDraftSchema);

    expect(reachable).toEqual([]);
    for (const schema of reachable) {
      const result = schema.safeParse(inheritedDraft);
      expect(result.success && result.data !== inheritedDraft).toBe(false);
    }
  });

  it("rejects a seller inherited from a polluted Object prototype", () => {
    const input = draft() as unknown as Record<string, unknown>;
    const seller = input.seller;
    delete input.seller;
    Object.defineProperty(Object.prototype, "seller", {
      configurable: true,
      enumerable: false,
      value: seller,
      writable: true,
    });
    try {
      expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);
    } finally {
      Reflect.deleteProperty(Object.prototype, "seller");
    }
  });

  it("rejects a project whose missing seller resolves through Object prototype pollution", () => {
    const project = JSON.parse(core.serializeProject(draft())) as {
      draft: Record<string, unknown>;
    };
    const seller = project.draft.seller;
    delete project.draft.seller;
    const serialized = JSON.stringify(project);
    Object.defineProperty(Object.prototype, "seller", {
      configurable: true,
      enumerable: false,
      value: seller,
      writable: true,
    });
    try {
      expect(() => core.parseProject(serialized)).toThrow();
    } finally {
      Reflect.deleteProperty(Object.prototype, "seller");
    }
  });

  it("rejects accessors without invoking them", () => {
    const input = draft();
    const seller = input.seller;
    let getterCalls = 0;
    Object.defineProperty(input, "seller", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return seller;
      },
    });

    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("turns a throwing Proxy trap into a safeParse failure", () => {
    const trapped = new Proxy(draft(), {
      ownKeys() {
        throw new Error("malicious ownKeys trap");
      },
    });
    let result: { success: boolean } | undefined;
    expect(() => {
      result = core.DocumentDraftSchema.safeParse(trapped);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("rejects symbols and prototype-pollution keys on composite input", () => {
    const symbolInput = draft() as StandardGoodsQuoteDraft & Record<PropertyKey, unknown>;
    symbolInput[Symbol("hidden")] = "value";
    expect(core.DocumentDraftSchema.safeParse(symbolInput).success).toBe(false);

    for (const key of ["__proto__", "constructor", "prototype"] as const) {
      const input = draft();
      Object.defineProperty(input, key, {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });
      expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects an overlong array own key before any index regular expression", () => {
    const input = draft();
    const overlongKey = "k".repeat(1_000_000);
    const sparseLines = new Array(100);
    Object.defineProperty(sparseLines, overlongKey, {
      configurable: true,
      enumerable: true,
      value: "unexpected",
      writable: true,
    });
    input.lineItems = sparseLines as StandardGoodsQuoteDraft["lineItems"];

    const originalTest = RegExp.prototype.test;
    let overlongKeyScans = 0;
    RegExp.prototype.test = function test(value: string) {
      if (value === overlongKey) {
        overlongKeyScans += 1;
      }
      return originalTest.call(this, value);
    };
    let result: { success: boolean };
    try {
      result = core.DocumentDraftSchema.safeParse(input);
    } finally {
      RegExp.prototype.test = originalTest;
    }

    expect(result.success).toBe(false);
    expect(overlongKeyScans).toBe(0);
  });

  it("rejects one shared million-character string before any HTML scan", () => {
    const input = draft();
    const huge = "汉".repeat(1_000_000);
    const initial = firstLine(input);
    input.lineItems = Array.from({ length: 100 }, (_, index) => ({
      ...initial,
      id: `shared-${index}`,
      name: huge,
    }));

    const originalTest = RegExp.prototype.test;
    let hugeScans = 0;
    let thrown: unknown;
    let success: boolean | undefined;
    RegExp.prototype.test = function test(value: string) {
      if (value === huge) {
        hugeScans += 1;
        throw new Error("Huge string reached an HTML regular expression");
      }
      return originalTest.call(this, value);
    };
    try {
      success = core.DocumentDraftSchema.safeParse(input).success;
    } catch (error) {
      thrown = error;
    } finally {
      RegExp.prototype.test = originalTest;
    }

    expect(thrown).toBeUndefined();
    expect(success).toBe(false);
    expect(hugeScans).toBe(0);
  });

  it.each([
    ["aggregate characters", "x".repeat(6_000)],
    ["aggregate UTF-8 bytes", "汉".repeat(4_000)],
  ])("rejects %s budget overflow before HTML scans", (_label, sharedDescription) => {
    const input = draft();
    const initial = firstLine(input);
    input.lineItems = Array.from({ length: 100 }, (_, index) => ({
      ...initial,
      id: `budget-${index}`,
      description: sharedDescription,
    }));

    const originalTest = RegExp.prototype.test;
    let scans = 0;
    RegExp.prototype.test = function test(value: string) {
      if (value === sharedDescription) {
        scans += 1;
      }
      return originalTest.call(this, value);
    };
    let result: { success: boolean };
    try {
      result = core.DocumentDraftSchema.safeParse(input);
    } finally {
      RegExp.prototype.test = originalTest;
    }

    expect(result.success).toBe(false);
    expect(scans).toBe(0);
  });

  it("rejects table cells with more keys than the 20-column contract", () => {
    const model = fullModel();
    const table = model.nodes.find((node) => node.type === "table");
    if (!table || table.type !== "table") {
      throw new Error("Missing table fixture");
    }
    const row = table.rows[0];
    if (!row) {
      throw new Error("Missing table row fixture");
    }
    row.cells = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`cell-${index}`, String(index)]),
    );

    expect(core.DocumentTableNodeSchema.safeParse(table).success).toBe(false);
    expect(core.DocumentModelSchema.safeParse(model).success).toBe(false);
  });

  it("rejects every public oversized array path before reading elements", () => {
    const baseDraft = draft();
    const calculation = core.calculateQuoteTotals(baseDraft);
    const model = fullModel();
    const table = modelNode("table");
    const parties = modelNode("parties");
    const envelope = core.parseProject(core.serializeProject(baseDraft));

    const cases: Array<{
      name: string;
      limit: number;
      schema: SchemaLike;
      build(array: unknown[]): unknown;
    }> = [
      {
        name: "template.supportedCurrencies",
        limit: 3,
        schema: core.TemplateDefinitionSchema,
        build: (array) => ({ ...core.STANDARD_GOODS_QUOTE_TEMPLATE, supportedCurrencies: array }),
      },
      {
        name: "draft.lineItems",
        limit: 100,
        schema: core.StandardGoodsQuoteDraftSchema,
        build: (array) => ({ ...baseDraft, lineItems: array }),
      },
      {
        name: "documentDraft.lineItems",
        limit: 100,
        schema: core.DocumentDraftSchema,
        build: (array) => ({ ...baseDraft, lineItems: array }),
      },
      {
        name: "calculation.lines",
        limit: 100,
        schema: core.QuoteCalculationSchema,
        build: (array) => ({ ...calculation, lines: array }),
      },
      {
        name: "metadata.entries",
        limit: 20,
        schema: core.DocumentMetadataNodeSchema,
        build: (array) => ({ ...modelNode("metadata"), entries: array }),
      },
      {
        name: "parties.parties",
        limit: 2,
        schema: core.DocumentPartiesNodeSchema,
        build: (array) => ({ ...parties, parties: array }),
      },
      {
        name: "parties.details",
        limit: 20,
        schema: core.DocumentPartiesNodeSchema,
        build: (array) => {
          const partyList = parties.parties as Array<Record<string, unknown>>;
          return {
            ...parties,
            parties: [{ ...partyList[0], details: array }, partyList[1]],
          };
        },
      },
      {
        name: "table.columns",
        limit: 20,
        schema: core.DocumentTableNodeSchema,
        build: (array) => ({ ...table, columns: array }),
      },
      {
        name: "table.rows",
        limit: 100,
        schema: core.DocumentTableNodeSchema,
        build: (array) => ({ ...table, rows: array }),
      },
      {
        name: "totals.entries",
        limit: 10,
        schema: core.DocumentTotalsNodeSchema,
        build: (array) => ({ ...modelNode("totals"), entries: array }),
      },
      {
        name: "terms.entries",
        limit: 10,
        schema: core.DocumentTermsNodeSchema,
        build: (array) => ({ ...modelNode("terms"), entries: array }),
      },
      {
        name: "notice.paragraphs",
        limit: 10,
        schema: core.DocumentNoticeNodeSchema,
        build: (array) => ({ ...modelNode("notice"), paragraphs: array }),
      },
      {
        name: "documentNode.table.columns",
        limit: 20,
        schema: core.DocumentNodeSchema,
        build: (array) => ({ ...table, columns: array }),
      },
      {
        name: "documentModel.nodes",
        limit: 30,
        schema: core.DocumentModelSchema,
        build: (array) => ({ ...model, nodes: array }),
      },
      {
        name: "risk.path",
        limit: 20,
        schema: core.RiskFindingSchema,
        build: (array) => ({ code: "risk", severity: "warning", message: "risk", path: array }),
      },
      {
        name: "project.draft.lineItems",
        limit: 100,
        schema: core.ProjectEnvelopeSchema,
        build: (array) => ({ ...envelope, draft: { ...envelope.draft, lineItems: array } }),
      },
      {
        name: "project.calculation.lines",
        limit: 100,
        schema: core.ProjectEnvelopeSchema,
        build: (array) => ({
          ...envelope,
          calculation: { ...envelope.calculation, lines: array },
        }),
      },
    ];

    for (const testCase of cases) {
      const sparse = unreadSparseArray(testCase.limit + 1);
      const result = testCase.schema.safeParse(testCase.build(sparse.value));
      expect(result.success, testCase.name).toBe(false);
      expect(sparse.numericReads(), testCase.name).toBe(0);
    }
  });

  it.each(["toString", "valueOf"])(
    "does not inherit the policy object property %s as an array limit",
    (field) => {
      const oversized = descriptorObservedDenseArray(101);
      const input = {
        ...modelNode("metadata"),
        [field]: oversized.value,
      };

      expect(core.DocumentMetadataNodeSchema.safeParse(input).success).toBe(false);
      expect(oversized.numericDescriptorReads()).toBe(0);
    },
  );

  it.each([
    ["U+0000", "\u0000"],
    ["U+0008", "\u0008"],
    ["U+000B", "\u000b"],
    ["U+000C", "\u000c"],
    ["U+000E", "\u000e"],
    ["U+001F", "\u001f"],
    ["isolated high surrogate", "\ud800"],
    ["isolated low surrogate", "\udc00"],
    ["U+FFFE", "\ufffe"],
    ["U+FFFF", "\uffff"],
  ])("rejects XML 1.0-invalid text %s in public draft and project parsing", (_label, invalid) => {
    const input = draft();
    input.terms.notes = `before${invalid}after`;
    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);

    const validSerialized = core.serializeProject(draft());
    const project = JSON.parse(validSerialized) as {
      draft: { terms: { notes?: string } };
    };
    project.draft.terms.notes = `before${invalid}after`;
    expect(() => core.parseProject(JSON.stringify(project))).toThrow();
  });

  it("preserves XML-valid tabs, newlines, carriage returns, and surrogate pairs", () => {
    const validText = "制表符\t换行\n回车\rEmoji 😀";
    const input = draft();
    input.terms.notes = validText;
    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(true);

    const parsed = core.parseProject(core.serializeProject(input));
    expect(parsed.draft.terms.notes).toBe(validText);
  });

  it("rejects a trailing isolated high surrogate in draft parsing and project serialization", () => {
    const input = draft();
    input.terms.notes = "末尾无效字符\ud800";

    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(false);
    expect(() => core.serializeProject(input)).toThrow();
  });

  it("accepts a fully populated valid draft at the 100-line boundary", () => {
    const input = draft();
    input.meta.number = "报".repeat(64);
    input.seller = {
      name: "甲".repeat(200),
      address: "址".repeat(500),
      contactName: "联".repeat(100),
      phone: "1".repeat(50),
      email: "e".repeat(254),
      taxId: "税".repeat(100),
      bankName: "行".repeat(200),
      bankAccount: "8".repeat(100),
    };
    input.buyer = { ...input.seller, name: "乙".repeat(200) };
    input.terms = {
      delivery: "交".repeat(4_000),
      payment: "付".repeat(4_000),
      quality: "质".repeat(4_000),
      warranty: "保".repeat(4_000),
      notes: "注".repeat(10_000),
    };
    input.lineItems = Array.from({ length: 100 }, (_, index) => ({
      id: `line-${String(index).padStart(3, "0")}`,
      name: "商".repeat(300),
      sku: "号".repeat(100),
      specification: "规".repeat(500),
      description: "描".repeat(1_000),
      unit: "台".repeat(50),
      quantity: "999999999999.999999",
      unitPriceMinor: "999999999999999999",
      discountBps: 10_000,
      taxRateBps: 10_000,
    }));

    expect(core.DocumentDraftSchema.safeParse(input).success).toBe(true);
  });
});
