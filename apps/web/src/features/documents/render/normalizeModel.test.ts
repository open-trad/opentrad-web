import {
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  type DocumentModelV2,
} from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import {
  attachmentStatusText,
  complianceRequirementText,
  documentDisclaimerText,
  localizedTextParts,
  localizedTextValue,
  normalizeDocumentModel,
  semanticTextDigest,
} from "./normalizeModel";
import { createEveryBlockModel } from "./testFixtures";

function expectSafeFrozenGraph(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);

  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value)).toBe(Array.prototype);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      expect(descriptor && "value" in descriptor).toBe(true);
      if (descriptor && "value" in descriptor) expectSafeFrozenGraph(descriptor.value, seen);
    }
    expect(Reflect.ownKeys(value)).toHaveLength(value.length + 1);
    return;
  }

  expect(Object.getPrototypeOf(value)).toBeNull();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    expect(descriptor && "value" in descriptor).toBe(true);
    if (descriptor && "value" in descriptor) expectSafeFrozenGraph(descriptor.value, seen);
  }
}

describe("normalizeDocumentModel", () => {
  it("maps every V1 node in order while preserving identity, page setup and table values", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "html-v1",
      now: "2026-08-19T00:00:00.000Z",
    });
    draft.meta.number = "QT-V1-001";
    draft.seller.name = "宁波本地卖方";
    draft.buyer.name = "上海本地买方";
    draft.terms.delivery = "十个工作日交付";
    draft.terms.payment = "签约后付款";
    const source = compileStandardGoodsQuote(draft);
    const before = JSON.stringify(source);

    const normalized = normalizeDocumentModel(source);

    expect(normalized).not.toBe(source);
    expect(normalized).toMatchObject({
      schemaVersion: "2.0.0",
      documentId: "html-v1",
      template: {
        id: "quotation.goods.standard.v1",
        version: "1.0.0",
        basisDate: "2026-08-19",
      },
      documentKind: "quotation",
      language: "zh-CN",
      title: { zhCN: "标准货物报价单" },
      pageDefaults: source.page,
      disclaimers: [],
    });
    expect(normalized.sections[0]?.blocks.map(({ id, type }) => [id, type])).toEqual([
      ["title", "heading"],
      ["quotation-meta", "keyValueGrid"],
      ["parties", "parties"],
      ["line-items", "table"],
      ["totals", "totals"],
      ["terms", "clauseGroup"],
      ["notice", "notice"],
      ["signature", "signatureGroup"],
    ]);

    const v1Table = source.nodes.find((node) => node.type === "table");
    const v2Table = normalized.sections[0]?.blocks.find((block) => block.type === "table");
    if (!v1Table || !v2Table || v1Table.type !== "table" || v2Table.type !== "table") {
      throw new Error("Expected both V1 and V2 tables");
    }
    expect(
      v2Table.columns.map((column) => ({
        id: column.id,
        label: column.label.zhCN,
        align: column.align,
        width: column.width,
      })),
    ).toEqual(v1Table.columns);
    expect(
      v2Table.rows.map((row) => ({
        id: row.id,
        cells: Object.fromEntries(
          Object.entries(row.cells).map(([key, value]) => [key, value.zhCN]),
        ),
      })),
    ).toEqual(v1Table.rows);
    expect(v2Table.repeatHeader).toBe(v1Table.repeatHeader);
    expect(v2Table.pagePolicy).toEqual(v1Table.pagePolicy);

    const v2Terms = normalized.sections[0]?.blocks.find((block) => block.type === "clauseGroup");
    expect(v2Terms).toMatchObject({
      title: { zhCN: "条款与备注" },
      clauses: [
        {
          id: "delivery",
          number: "1",
          title: { zhCN: "交货条款" },
          paragraphs: [{ zhCN: "十个工作日交付" }],
        },
        {
          id: "payment",
          number: "2",
          title: { zhCN: "付款条款" },
          paragraphs: [{ zhCN: "签约后付款" }],
        },
      ],
    });
    const v2Signature = normalized.sections[0]?.blocks.find(
      (block) => block.type === "signatureGroup",
    );
    expect(v2Signature).toMatchObject({
      signers: [
        {
          role: { zhCN: "报价方签署/盖章" },
          name: "________________",
          dateLabel: { zhCN: "签署日期" },
        },
      ],
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.nodes)).toBe(false);
  });

  it("validates and clones V2 without mutating or freezing caller-owned objects", () => {
    const source = createEveryBlockModel();
    const before = JSON.stringify(source);

    const normalized = normalizeDocumentModel(source);

    expect(normalized).not.toBe(source);
    expect(normalized).toEqual(source);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.sections)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.sections)).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("accepts legal V1 blank values and Chinese ids without weakening the public V2 schema", () => {
    const source = structuredClone(
      compileStandardGoodsQuote(
        createStandardGoodsQuoteDraft({
          id: "compat-visible-values",
          now: "2026-08-19T00:00:00.000Z",
        }),
      ),
    );
    const heading = source.nodes.find((node) => node.type === "heading");
    const metadata = source.nodes.find((node) => node.type === "metadata");
    if (!heading || heading.type !== "heading" || !metadata || metadata.type !== "metadata") {
      throw new Error("Expected V1 heading and metadata fixtures");
    }
    heading.id = "标题 节点";
    const firstEntry = metadata.entries[0];
    if (!firstEntry) throw new Error("Expected V1 metadata fixture");
    firstEntry.value = "";
    const before = JSON.stringify(source);

    const normalized = normalizeDocumentModel(source);

    expect(normalized.template).toEqual({
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    });
    expect(normalized.sections[0]?.blocks[0]).toMatchObject({
      id: "标题 节点",
      type: "heading",
    });
    const normalizedMetadata = normalized.sections[0]?.blocks[1];
    if (!normalizedMetadata || normalizedMetadata.type !== "keyValueGrid") {
      throw new Error("Expected normalized metadata block");
    }
    expect(normalizedMetadata).toMatchObject({
      id: "quotation-meta",
      type: "keyValueGrid",
    });
    expect(normalizedMetadata.entries[0]).toMatchObject({
      id: "quote-number",
      value: { zhCN: "" },
    });
    expect(normalized.sections[0]?.blocks.map((block) => block.type)).toEqual(
      source.nodes.map((node) =>
        node.type === "metadata"
          ? "keyValueGrid"
          : node.type === "terms"
            ? "clauseGroup"
            : node.type === "signature"
              ? "signatureGroup"
              : node.type,
      ),
    );
    expect(normalizeDocumentModel(normalized)).toBe(normalized);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.sections)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(JSON.stringify(source)).toBe(before);

    const invalidPublicV2 = structuredClone(createEveryBlockModel()) as unknown as {
      title: { zhCN: string };
    };
    invalidPublicV2.title.zhCN = "";
    expect(() => normalizeDocumentModel(invalidPublicV2 as unknown as DocumentModelV2)).toThrow();
  });

  it("creates a null-prototype data-only graph and ignores inherited English getters", () => {
    let getterCalls = 0;
    const localObjectPrototype = Object.create(null) as object;
    Object.defineProperty(localObjectPrototype, "enUS", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "POLLUTED";
      },
    });
    const locallyPollutedText = Object.create(localObjectPrototype) as { zhCN: string };
    Object.defineProperty(locallyPollutedText, "zhCN", {
      configurable: true,
      enumerable: true,
      value: "安全中文",
      writable: true,
    });
    const source = compileStandardGoodsQuote(
      createStandardGoodsQuoteDraft({
        id: "null-prototype-compat",
        now: "2026-08-19T00:00:00.000Z",
      }),
    );
    const normalized = normalizeDocumentModel(source);
    const digestBefore = semanticTextDigest(source, "zh-CN");
    const digestAfter = semanticTextDigest(normalized, "zh-CN");

    expect(localizedTextParts(locallyPollutedText, "zh-en")).toEqual([
      { language: "zh-CN", text: "安全中文" },
    ]);
    expect(getterCalls).toBe(0);
    expectSafeFrozenGraph(normalized);
    expect(normalizeDocumentModel(normalized)).toBe(normalized);
    expect(digestAfter).toBe(digestBefore);
  });

  it("normalizes missing and extra V1 cells plus duplicate ids without dropping visible order", () => {
    const source = structuredClone(
      compileStandardGoodsQuote(
        createStandardGoodsQuoteDraft({
          id: "v1-irregular-table",
          now: "2026-08-19T00:00:00.000Z",
        }),
      ),
    );
    const heading = source.nodes.find((node) => node.type === "heading");
    const metadata = source.nodes.find((node) => node.type === "metadata");
    const parties = source.nodes.find((node) => node.type === "parties");
    const table = source.nodes.find((node) => node.type === "table");
    if (
      !heading ||
      heading.type !== "heading" ||
      !metadata ||
      metadata.type !== "metadata" ||
      !parties ||
      parties.type !== "parties" ||
      !table ||
      table.type !== "table"
    ) {
      throw new Error("Expected complete V1 compatibility fixture");
    }
    const secondNode = source.nodes[1];
    const firstMetadataEntry = metadata.entries[0];
    const secondMetadataEntry = metadata.entries[1];
    const firstParty = parties.parties[0];
    const secondParty = parties.parties[1];
    const firstColumn = table.columns[0];
    const firstRow = table.rows[0];
    if (
      !secondNode ||
      !firstMetadataEntry ||
      !secondMetadataEntry ||
      !firstParty ||
      !secondParty ||
      !firstColumn ||
      !firstRow
    ) {
      throw new Error("Expected V1 table entries");
    }
    secondNode.id = heading.id;
    secondMetadataEntry.id = firstMetadataEntry.id;
    secondParty.role = firstParty.role;
    delete firstRow.cells[firstColumn.id];
    firstRow.cells["extra-cell"] = "不应进入可见表格";

    const normalized = normalizeDocumentModel(source);
    const normalizedBlocks = normalized.sections[0]?.blocks ?? [];
    const normalizedMetadata = normalizedBlocks.find((block) => block.type === "keyValueGrid");
    const normalizedParties = normalizedBlocks.find((block) => block.type === "parties");
    const normalizedTable = normalizedBlocks.find((block) => block.type === "table");
    if (
      !normalizedMetadata ||
      normalizedMetadata.type !== "keyValueGrid" ||
      !normalizedParties ||
      normalizedParties.type !== "parties" ||
      !normalizedTable ||
      normalizedTable.type !== "table"
    ) {
      throw new Error("Expected normalized V1 compatibility blocks");
    }
    const normalizedRow = normalizedTable.rows[0];
    if (!normalizedRow) throw new Error("Expected normalized V1 row");

    expect(normalizedBlocks.map((block) => block.id).slice(0, 2)).toEqual([heading.id, heading.id]);
    expect(normalizedMetadata.entries.map((entry) => entry.id).slice(0, 2)).toEqual([
      firstMetadataEntry.id,
      firstMetadataEntry.id,
    ]);
    expect(normalizedParties.parties.map((party) => party.id)).toEqual([
      firstParty.role,
      firstParty.role,
    ]);
    expect(normalizedRow.cells[firstColumn.id]).toEqual({ zhCN: "" });
    expect(Object.hasOwn(normalizedRow.cells, "extra-cell")).toBe(false);
    expect(Object.getPrototypeOf(normalizedRow.cells)).toBeNull();
    expect(() => semanticTextDigest(normalized, "zh-CN")).not.toThrow();
    expect(semanticTextDigest(normalized, "zh-CN")).not.toContain("不应进入可见表格");
  });

  it("rejects unsupported versions, unknown blocks and markup-bearing hostile text", () => {
    expect(() =>
      normalizeDocumentModel({ schemaVersion: "3.0.0" } as unknown as DocumentModelV2),
    ).toThrow("不支持的文档模型版本");

    const unknownBlock = structuredClone(createEveryBlockModel()) as unknown as {
      sections: Array<{ blocks: Array<Record<string, unknown>> }>;
    };
    unknownBlock.sections[0]?.blocks.push({ type: "iframe", id: "hostile-frame" });
    expect(() => normalizeDocumentModel(unknownBlock as unknown as DocumentModelV2)).toThrow();

    const hostileText = structuredClone(createEveryBlockModel()) as unknown as {
      title: { zhCN: string; enUS?: string };
    };
    hostileText.title.zhCN = '<img src="https://evil.example/track">';
    expect(() => normalizeDocumentModel(hostileText as unknown as DocumentModelV2)).toThrow();
  });

  it("reads no accessor while identifying an untrusted schema version", () => {
    let reads = 0;
    const source = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(source, "schemaVersion", {
      enumerable: true,
      get() {
        reads += 1;
        return "2.0.0";
      },
    });

    expect(() => normalizeDocumentModel(source as unknown as DocumentModelV2)).toThrow(
      "不支持的文档模型版本",
    );
    expect(reads).toBe(0);
  });
});

describe("localized semantic text", () => {
  it("provides stable Chinese, English and paired text with a Chinese fallback", () => {
    const bilingual = { zhCN: "中文", enUS: "English" };
    const chineseOnly = { zhCN: "仅中文" };

    expect(localizedTextParts(bilingual, "zh-CN")).toEqual([{ language: "zh-CN", text: "中文" }]);
    expect(localizedTextParts(bilingual, "en-US")).toEqual([
      { language: "en-US", text: "English" },
    ]);
    expect(localizedTextParts(bilingual, "zh-en")).toEqual([
      { language: "zh-CN", text: "中文" },
      { language: "en-US", text: "English" },
    ]);
    expect(localizedTextValue(bilingual, "zh-en")).toBe("中文 / English");
    expect(localizedTextValue(chineseOnly, "en-US")).toBe("仅中文");
    expect(documentDisclaimerText("quotation-non-advice", "zh-en")).toBe(
      "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。 / Generated with OpenTrad. This document is not legal, tax, or accounting advice.",
    );
    expect(complianceRequirementText(true, "zh-en")).toBe("实质性要求 / Substantial requirement");
    expect(complianceRequirementText(false, "zh-en")).toBe(
      "非实质性要求 / Non-substantial requirement",
    );
    const attachment = createEveryBlockModel().attachmentManifest[0];
    if (!attachment) throw new Error("Expected attachment fixture");
    expect(attachmentStatusText(attachment, "zh-en")).toBe("已附加 / Attached");
  });

  it("collects every semantic block value in order and excludes presentation-only watermarks", () => {
    const digest = semanticTextDigest(createEveryBlockModel(), "zh-en");

    expect(digest).toContain("服务报价 / SERVICE QUOTATION");
    expect(digest).toContain("3.1");
    expect(digest).toContain("满足 / Comply");
    expect(digest).toContain("附件一.pdf");
    expect(digest).toContain("报价方 / Offeror");
    expect(digest).not.toContain("内部底稿");
    expect(digest.indexOf("封面 / Cover")).toBeLessThan(digest.indexOf("第一章 / Chapter 1"));
  });

  it("keeps the V1 non-advice disclaimer exactly once through its preserved notice", () => {
    const source = compileStandardGoodsQuote(
      createStandardGoodsQuoteDraft({
        id: "single-v1-disclaimer",
        now: "2026-08-19T00:00:00.000Z",
      }),
    );
    const normalized = normalizeDocumentModel(source);
    const disclaimer = "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。";
    const digest = semanticTextDigest(normalized, "zh-CN");

    expect(normalized.disclaimers).toEqual([]);
    expect(digest.split(disclaimer)).toHaveLength(2);
  });
});
