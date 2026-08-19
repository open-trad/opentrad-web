import { describe, expect, it, vi } from "vitest";
import * as rootCore from "../src/index";
import {
  type DocumentModelV2,
  DocumentModelV2Schema,
  highestExportImpact,
  type RiskFindingV2,
  RiskFindingV2Schema,
} from "../src/v2/index";

function localized(zhCN: string, enUS?: string) {
  return enUS === undefined ? { zhCN } : { zhCN, enUS };
}

function createModel(): Record<string, unknown> {
  return {
    schemaVersion: "2.0.0",
    documentId: "bid-1",
    template: {
      id: "bid.construction.works.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    documentKind: "bid",
    language: "zh-CN",
    title: localized("建设工程施工投标底稿", "Construction tender working draft"),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    sections: [
      {
        id: "front-matter",
        blocks: [
          {
            type: "cover",
            id: "cover",
            title: localized("建设工程施工投标底稿"),
            subtitle: localized("内部编制版本"),
          },
          { type: "toc", id: "toc", maxDepth: 3 },
          { type: "pageBreak", id: "front-page-break" },
        ],
      },
      {
        id: "commercial",
        page: { orientation: "landscape" },
        blocks: [
          { type: "heading", id: "commercial-heading", level: 1, text: localized("报价") },
          {
            type: "paragraph",
            id: "commercial-intro",
            text: localized("本节列示投标报价。", "This section states the bid price."),
          },
          {
            type: "keyValueGrid",
            id: "commercial-meta",
            entries: [
              { id: "project-name", label: localized("项目名称"), value: localized("示例项目") },
            ],
          },
          {
            type: "parties",
            id: "parties",
            parties: [
              {
                id: "bidder",
                role: localized("投标人"),
                name: localized("示例公司"),
                details: [localized("统一社会信用代码：91310000TEST")],
              },
            ],
          },
          {
            type: "table",
            id: "price-table",
            columns: [
              { id: "item", label: localized("项目"), width: "60%", align: "left" },
              { id: "amount", label: localized("金额"), width: "40%", align: "right" },
            ],
            rows: [
              {
                id: "row-1",
                cells: {
                  item: localized("施工服务"),
                  amount: localized("¥100,000.00"),
                },
              },
            ],
            repeatHeader: true,
            pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
          },
          {
            type: "totals",
            id: "price-totals",
            entries: [
              { id: "grand-total", label: localized("合计"), value: localized("¥100,000.00") },
            ],
          },
          {
            type: "complianceMatrix",
            id: "compliance-matrix",
            columns: [
              { id: "requirement", label: localized("要求"), width: "50%", align: "left" },
              { id: "response", label: localized("响应"), width: "50%", align: "left" },
            ],
            rows: [
              {
                id: "compliance-1",
                sourceRef: "招标文件第 3.2 条",
                substantial: true,
                cells: {
                  requirement: localized("工期 90 天"),
                  response: localized("完全响应"),
                },
              },
            ],
          },
        ],
      },
      {
        id: "terms",
        blocks: [
          {
            type: "clauseGroup",
            id: "contract-terms",
            title: localized("合同条款响应"),
            clauses: [
              {
                id: "clause-1",
                number: "1.1",
                title: localized("工期"),
                paragraphs: [localized("计划工期为 90 天。")],
              },
            ],
          },
          {
            type: "list",
            id: "checklist",
            ordered: true,
            items: [localized("核对报价"), localized("核对授权")],
          },
          {
            type: "notice",
            id: "working-draft-notice",
            tone: "warning",
            paragraphs: [localized("本文件仅为内部底稿。")],
          },
          {
            type: "declaration",
            id: "bid-declaration",
            title: localized("投标声明"),
            paragraphs: [localized("本公司对提交材料负责。")],
          },
          {
            type: "attachmentIndex",
            id: "attachment-index",
            attachmentIds: ["qualification-1"],
          },
          {
            type: "attachmentPage",
            id: "attachment-page-1",
            attachmentId: "qualification-1",
            pageNumber: 1,
          },
          {
            type: "signatureGroup",
            id: "signature-block",
            signers: [
              {
                role: localized("投标人"),
                name: "示例公司",
                dateLabel: localized("日期"),
                sealLabel: localized("盖章"),
              },
              {
                role: localized("法定代表人或授权代表"),
                name: "张三",
                dateLabel: localized("日期"),
              },
            ],
          },
        ],
      },
    ],
    watermarks: [{ id: "internal-draft", text: localized("内部底稿"), scope: "every-page" }],
    disclaimers: ["bid-authority"],
    attachmentManifest: [
      {
        id: "qualification-1",
        category: "qualification",
        displayName: "营业执照",
        mediaType: "application/pdf",
        pageCount: 1,
        required: true,
        sourceRef: "招标文件附件要求",
        localBlobKey: "attachment-qualification-1",
        status: "attached",
        includedInSubmission: true,
      },
    ],
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} fixture record`);
  }
  return value as Record<string, unknown>;
}

function requireRecords(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} fixture array`);
  return value.map((entry, index) => requireRecord(entry, `${label}[${index}]`));
}

function requireRecordAt(
  records: Array<Record<string, unknown>>,
  index: number,
  label: string,
): Record<string, unknown> {
  return requireRecord(records[index], label);
}

function sectionAt(model: Record<string, unknown>, index: number): Record<string, unknown> {
  return requireRecordAt(requireRecords(model.sections, "sections"), index, `section ${index}`);
}

function blocksAt(model: Record<string, unknown>, sectionIndex: number) {
  return requireRecords(sectionAt(model, sectionIndex).blocks, `section ${sectionIndex} blocks`);
}

function findBlock(
  model: Record<string, unknown>,
  sectionIndex: number,
  type: string,
): Record<string, unknown> {
  const block = blocksAt(model, sectionIndex).find((candidate) => candidate.type === type);
  return requireRecord(block, `${type} block`);
}

function createMaximalTabularModel(type: "table" | "complianceMatrix") {
  const columns = Array.from({ length: 20 }, (_, index) => ({
    id: `c${index}`,
    label: localized(`列${index}`, `Column ${index}`),
    width: "5%",
    align: "left",
  }));
  const rows = Array.from({ length: 500 }, (_, rowIndex) => {
    const cells = Object.fromEntries(
      columns.map((column) => [column.id, localized("值", "Value")]),
    );
    return type === "table"
      ? { id: `row-${rowIndex}`, cells }
      : {
          id: `row-${rowIndex}`,
          sourceRef: `requirement-${rowIndex}`,
          substantial: rowIndex % 2 === 0,
          cells,
        };
  });
  const block =
    type === "table"
      ? {
          type,
          id: "maximal-table",
          columns,
          rows,
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        }
      : { type, id: "maximal-compliance-matrix", columns, rows };
  const model = createModel();
  model.sections = [{ id: "maximal-tabular-section", blocks: [block] }];
  model.watermarks = [];
  model.attachmentManifest = [];
  return model;
}

function assertReadonlyTypes(model: DocumentModelV2, risk: RiskFindingV2): void {
  // @ts-expect-error Document models are recursively immutable public values.
  model.sections[0].id = "changed";
  // @ts-expect-error Block collections are immutable public values.
  model.sections.push({ id: "changed", blocks: [] });
  // @ts-expect-error Risk findings are immutable public values.
  risk.path?.push("changed");
}
void assertReadonlyTypes;

function expectNullPrototypeTree(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  if (!Array.isArray(value)) expect(Object.getPrototypeOf(value)).toBeNull();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor && "value" in descriptor).toBe(true);
    if (descriptor && "value" in descriptor) expectNullPrototypeTree(descriptor.value, seen);
  }
}

describe("DocumentModelV2", () => {
  it("is available as a direct root export for the planned renderer imports", () => {
    expect(rootCore.DocumentModelV2Schema).toBe(DocumentModelV2Schema);
    expect(rootCore.highestExportImpact).toBe(highestExportImpact);
  });

  it("supports every semantic block, landscape sections and multi-party signatures", () => {
    const parsed = DocumentModelV2Schema.parse(createModel());

    expect(parsed.sections[1]?.page?.orientation).toBe("landscape");
    expect(parsed.sections.flatMap((section) => section.blocks.map((block) => block.type))).toEqual(
      [
        "cover",
        "toc",
        "pageBreak",
        "heading",
        "paragraph",
        "keyValueGrid",
        "parties",
        "table",
        "totals",
        "complianceMatrix",
        "clauseGroup",
        "list",
        "notice",
        "declaration",
        "attachmentIndex",
        "attachmentPage",
        "signatureGroup",
      ],
    );
    expect(parsed.template).toEqual({
      id: "bid.construction.works.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    });
    expect(parsed.disclaimers).toEqual(["bid-authority"]);
  });

  it("accepts the frozen V1 standard quotation identity for the pure V1-to-V2 adapter", () => {
    const model = createModel();
    model.template = {
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    };
    model.documentKind = "quotation";

    const parsed = DocumentModelV2Schema.parse(model);
    expect(parsed.template.id).toBe("quotation.goods.standard.v1");
  });

  it("publishes recursively frozen null-prototype own-data output", () => {
    const parsed = DocumentModelV2Schema.parse(createModel());
    expectNullPrototypeTree(parsed);
  });

  it("rejects unknown fields at the model, section and block boundaries", () => {
    expect(DocumentModelV2Schema.safeParse({ ...createModel(), unexpected: true }).success).toBe(
      false,
    );

    const sectionUnknown = createModel();
    sectionAt(sectionUnknown, 0).unexpected = true;
    expect(DocumentModelV2Schema.safeParse(sectionUnknown).success).toBe(false);

    const blockUnknown = createModel();
    const block = requireRecordAt(blocksAt(blockUnknown, 0), 0, "cover block");
    block.dataUrl = "data:application/pdf;base64,AAAA";
    block.blob = new Blob(["not allowed"]);
    expect(DocumentModelV2Schema.safeParse(blockUnknown).success).toBe(false);
  });

  it("rejects unknown fields inside every localized-text boundary", () => {
    const titleUnknown = createModel();
    titleUnknown.title = { zhCN: "标题", unexpected: "不应被忽略" };
    expect(DocumentModelV2Schema.safeParse(titleUnknown).success).toBe(false);

    const blockUnknown = createModel();
    findBlock(blockUnknown, 0, "cover").title = { zhCN: "封面", unexpected: true };
    expect(DocumentModelV2Schema.safeParse(blockUnknown).success).toBe(false);

    const watermarkUnknown = createModel();
    const watermark = requireRecordAt(
      requireRecords(watermarkUnknown.watermarks, "watermarks"),
      0,
      "watermark",
    );
    watermark.text = { zhCN: "内部底稿", unexpected: [] };
    expect(DocumentModelV2Schema.safeParse(watermarkUnknown).success).toBe(false);
  });

  it.each([
    [
      "section",
      (model: Record<string, unknown>) => {
        const sections = requireRecords(model.sections, "sections");
        sections.push({ ...requireRecordAt(sections, 0, "first section") });
        model.sections = sections;
      },
    ],
    [
      "block",
      (model: Record<string, unknown>) => {
        const section = sectionAt(model, 0);
        const blocks = requireRecords(section.blocks, "blocks");
        blocks.push({ ...requireRecordAt(blocks, 0, "first block") });
        section.blocks = blocks;
      },
    ],
    [
      "table column",
      (model: Record<string, unknown>) => {
        const table = findBlock(model, 1, "table");
        const columns = requireRecords(table.columns, "table columns");
        columns.push({ ...requireRecordAt(columns, 0, "first column") });
        table.columns = columns;
      },
    ],
    [
      "table row",
      (model: Record<string, unknown>) => {
        const table = findBlock(model, 1, "table");
        const rows = requireRecords(table.rows, "table rows");
        rows.push({ ...requireRecordAt(rows, 0, "first row") });
        table.rows = rows;
      },
    ],
    [
      "attachment",
      (model: Record<string, unknown>) => {
        const attachments = requireRecords(model.attachmentManifest, "attachments");
        attachments.push({ ...requireRecordAt(attachments, 0, "first attachment") });
        model.attachmentManifest = attachments;
      },
    ],
  ])("rejects a duplicate %s id", (_label, mutate) => {
    const model = createModel();
    mutate(model);
    expect(DocumentModelV2Schema.safeParse(model).success).toBe(false);
  });

  it("rejects table cells that do not exactly match unique columns", () => {
    const model = createModel();
    const table = findBlock(model, 1, "table");
    const row = requireRecordAt(requireRecords(table.rows, "table rows"), 0, "first row");
    row.cells = { item: localized("施工服务"), unexpected: localized("越界") };

    expect(DocumentModelV2Schema.safeParse(model).success).toBe(false);
  });

  it("rejects attachment blocks whose references are absent or whose pages exceed the manifest", () => {
    const absent = createModel();
    const absentBlock = findBlock(absent, 2, "attachmentPage");
    absentBlock.attachmentId = "not-in-manifest";
    const absentResult = DocumentModelV2Schema.safeParse(absent);
    expect(absentResult.success).toBe(false);
    if (!absentResult.success) {
      expect(absentResult.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["sections", 2, "blocks", 5, "attachmentId"],
        }),
      );
    }

    const overflow = createModel();
    const overflowBlock = findBlock(overflow, 2, "attachmentPage");
    overflowBlock.pageNumber = 2;
    const overflowResult = DocumentModelV2Schema.safeParse(overflow);
    expect(overflowResult.success).toBe(false);
    if (!overflowResult.success) {
      expect(overflowResult.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["sections", 2, "blocks", 5, "pageNumber"],
        }),
      );
    }
  });

  it.each(["table", "complianceMatrix"] as const)(
    "accepts one maximal legal 20-column by 500-row %s",
    (type) => {
      const parsed = DocumentModelV2Schema.parse(createMaximalTabularModel(type));
      expect(parsed.sections[0]?.blocks[0]?.type).toBe(type);
      const block = parsed.sections[0]?.blocks[0];
      if (block?.type !== "table" && block?.type !== "complianceMatrix") {
        throw new Error("Expected a maximal tabular block");
      }
      expect(block.columns).toHaveLength(20);
      expect(block.rows).toHaveLength(500);
    },
  );

  it("keeps a document-specific aggregate value budget above one maximal matrix", () => {
    const model = createMaximalTabularModel("table");
    const second = createMaximalTabularModel("table");
    const firstSection = sectionAt(model, 0);
    const blocks = requireRecords(firstSection.blocks, "maximal blocks");
    const secondBlock = requireRecordAt(blocksAt(second, 0), 0, "second maximal table");
    secondBlock.id = "second-maximal-table";
    blocks.push(secondBlock);
    firstSection.blocks = blocks;

    const result = DocumentModelV2Schema.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/aggregate value budget/);
    }
  });

  it("rejects mismatched document kind while retaining exact template and basis identity", () => {
    expect(
      DocumentModelV2Schema.safeParse({ ...createModel(), documentKind: "contract" }).success,
    ).toBe(false);
    const wrongBasis = createModel();
    (wrongBasis.template as Record<string, unknown>).basisDate = "2026-08-20";
    expect(DocumentModelV2Schema.safeParse(wrongBasis).success).toBe(false);

    const wrongVersion = createModel();
    (wrongVersion.template as Record<string, unknown>).version = "1.0.1";
    expect(DocumentModelV2Schema.safeParse(wrongVersion).success).toBe(false);
  });

  it("enforces section, block, column, row and signer array budgets", () => {
    const cases: Array<[string, (model: Record<string, unknown>) => void]> = [
      [
        "sections",
        (model) => {
          model.sections = Array.from({ length: 101 }, (_, index) => ({
            id: `section-${index}`,
            blocks: [],
          }));
        },
      ],
      [
        "blocks",
        (model) => {
          sectionAt(model, 0).blocks = Array.from({ length: 101 }, (_, index) => ({
            type: "pageBreak",
            id: `break-${index}`,
          }));
        },
      ],
      [
        "columns",
        (model) => {
          const table = findBlock(model, 1, "table");
          table.columns = Array.from({ length: 21 }, (_, index) => ({
            id: `column-${index}`,
            label: localized(`列 ${index}`),
            width: "5%",
            align: "left",
          }));
        },
      ],
      [
        "rows",
        (model) => {
          const table = findBlock(model, 1, "table");
          table.rows = new Array(501);
        },
      ],
      [
        "signers",
        (model) => {
          const signature = findBlock(model, 2, "signatureGroup");
          signature.signers = Array.from({ length: 11 }, (_, index) => ({
            role: localized(`签署方 ${index}`),
            name: `签署人 ${index}`,
            dateLabel: localized("日期"),
          }));
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const model = createModel();
      mutate(model);
      expect(DocumentModelV2Schema.safeParse(model).success, label).toBe(false);
    }
  });

  it("rejects 501 table rows before reading their elements", () => {
    let numericReads = 0;
    const rows = new Proxy(new Array(501), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const model = createModel();
    const table = findBlock(model, 1, "table");
    table.rows = rows;

    expect(DocumentModelV2Schema.safeParse(model).success).toBe(false);
    expect(numericReads).toBe(0);
  });

  it("enforces XML-safe localized text and 10,000 characters per language", () => {
    const oversized = createModel();
    oversized.title = localized("字".repeat(10_001));
    expect(DocumentModelV2Schema.safeParse(oversized).success).toBe(false);

    const invalidUnicode = createModel();
    invalidUnicode.title = localized("无效\ud800");
    expect(DocumentModelV2Schema.safeParse(invalidUnicode).success).toBe(false);

    const markup = createModel();
    markup.title = localized("<script>alert(1)</script>");
    expect(DocumentModelV2Schema.safeParse(markup).success).toBe(false);
  });

  it("rejects dangerous keys, accessors and custom prototypes without invoking getters", () => {
    for (const key of ["__proto__", "constructor", "prototype"] as const) {
      const model = createModel();
      Object.defineProperty(model, key, {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });
      expect(DocumentModelV2Schema.safeParse(model).success).toBe(false);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }

    const getter = vi.fn(() => []);
    const accessor = createModel();
    Object.defineProperty(accessor, "sections", { enumerable: true, get: getter });
    expect(DocumentModelV2Schema.safeParse(accessor).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const inherited = Object.create(createModel());
    expect(DocumentModelV2Schema.safeParse(inherited).success).toBe(false);
  });

  it("turns throwing, nested and revoked Proxy traps into safeParse failures", () => {
    const throwing = new Proxy(createModel(), {
      ownKeys() {
        throw new Error("malicious ownKeys trap");
      },
    });
    const nested = createModel();
    const trappedTitle = new Proxy(localized("标题"), {
      getOwnPropertyDescriptor() {
        throw new Error("malicious descriptor trap");
      },
    });
    nested.title = trappedTitle;
    const nestedRevoked = createModel();
    const revokedTitle = Proxy.revocable(localized("标题"), {});
    nestedRevoked.title = revokedTitle.proxy;
    revokedTitle.revoke();
    const revoked = Proxy.revocable(createModel(), {});
    revoked.revoke();

    expect(() => DocumentModelV2Schema.safeParse(throwing)).not.toThrow();
    expect(DocumentModelV2Schema.safeParse(throwing).success).toBe(false);
    expect(() => DocumentModelV2Schema.safeParse(nested)).not.toThrow();
    expect(DocumentModelV2Schema.safeParse(nested).success).toBe(false);
    expect(() => DocumentModelV2Schema.safeParse(nestedRevoked)).not.toThrow();
    expect(DocumentModelV2Schema.safeParse(nestedRevoked).success).toBe(false);
    expect(() => DocumentModelV2Schema.safeParse(revoked.proxy)).not.toThrow();
    expect(DocumentModelV2Schema.safeParse(revoked.proxy).success).toBe(false);
  });
});

describe("V2 risk findings", () => {
  it("orders blockSubmission above watermark and advisory deterministically", () => {
    expect(highestExportImpact([])).toBe("advisory");
    expect(highestExportImpact(["watermark", "advisory"])).toBe("watermark");
    expect(highestExportImpact(["advisory", "blockSubmission", "watermark"])).toBe(
      "blockSubmission",
    );
  });

  it("publishes bounded immutable risk findings", () => {
    const risk = RiskFindingV2Schema.parse({
      code: "BID_SOURCE_VERSION_MISSING",
      severity: "error",
      impact: "blockSubmission",
      message: "缺少招标文件版本。",
      path: ["procurement", "sourceVersion"],
    });
    expectNullPrototypeTree(risk);
    expect(risk.impact).toBe("blockSubmission");
    expect(
      RiskFindingV2Schema.safeParse({ ...risk, impact: "ignore", unknown: true }).success,
    ).toBe(false);
    expect(
      RiskFindingV2Schema.safeParse({
        code: "INVALID_UNICODE",
        severity: "warning",
        impact: "advisory",
        message: "无效\ud800",
      }).success,
    ).toBe(false);
  });
});
