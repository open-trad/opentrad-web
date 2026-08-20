import { describe, expect, it, vi } from "vitest";
import {
  createTemplateRegistry,
  EntityPartyV2Schema,
  LocalizedTextSchema,
  OFFICIAL_SOURCES,
  type TemplateDefinitionV2,
  TemplateDefinitionV2Schema,
  TemplateFieldManifestEntryV1Schema,
  type TemplateRegistration,
} from "../src/v2/index";

interface TestDraft {
  templateId: "quotation.service.project.v1";
  templateVersion: "1.0.0";
  seller?: { legalName: string };
  enabled?: boolean;
  mode?: string;
  items?: Array<{ id: string; name: string }>;
  tags?: string[];
  attachmentId?: string;
  attachments?: unknown[];
}

function createDefinition() {
  return {
    id: "quotation.service.project.v1" as const,
    version: "1.0.0" as const,
    category: "quotation" as const,
    name: "项目/服务报价单",
    summary: "按服务项、里程碑和验收节点报价",
    basisDate: "2026-08-19" as const,
    languages: ["zh-CN"] as const,
    defaultLanguage: "zh-CN" as const,
    allowedLayouts: ["classic-formal.v1", "modern-business.v1"] as const,
    defaultLayout: "modern-business.v1" as const,
    supportedOutputs: ["docx", "pdf", "json", "opentrad"] as const,
    sourceKeys: ["samr-contract-library"] as const,
    disclaimerProfile: "quotation" as const,
    fieldManifest: [
      {
        path: "seller.legalName",
        section: "seller",
        label: "报价方名称",
        control: "text" as const,
        required: true,
      },
    ],
  };
}

function createRegistration(): TemplateRegistration<TestDraft> {
  return {
    definition: createDefinition(),
    parseDraft: (value) => value as TestDraft,
    createDraft: (_input: { id: string; now: string | Date }) => ({
      templateId: "quotation.service.project.v1",
      templateVersion: "1.0.0",
    }),
    compile: () => ({ schemaVersion: "2.0.0" }),
    preflight: () => [],
  };
}

function createEditorDefinition() {
  return {
    ...createDefinition(),
    fieldManifest: [
      {
        path: "seller.legalName",
        section: "seller",
        label: "报价方名称",
        control: "text" as const,
        valueKind: "string" as const,
        required: true,
        visibleWhen: { path: "enabled", equals: true },
      },
      {
        path: "enabled",
        section: "seller",
        label: "启用",
        control: "checkbox" as const,
        valueKind: "boolean" as const,
        required: true,
      },
      {
        path: "mode",
        section: "seller",
        label: "模式",
        control: "select" as const,
        valueKind: "enum" as const,
        required: true,
        options: [
          { value: "standard", label: "标准" },
          { value: "custom", label: "定制" },
        ],
      },
      {
        path: "items",
        section: "seller",
        label: "项目",
        control: "repeatable" as const,
        valueKind: "object-list" as const,
        required: true,
        minItems: 1,
        maxItems: 3,
        item: {
          kind: "object" as const,
          idPath: "id",
          fields: [
            {
              path: "name",
              label: "名称",
              control: "text" as const,
              valueKind: "string" as const,
              required: true,
            },
          ],
        },
      },
      {
        path: "tags",
        section: "seller",
        label: "标签",
        control: "repeatable" as const,
        valueKind: "string-list" as const,
        required: false,
        minItems: 0,
        maxItems: 10,
        item: {
          kind: "value" as const,
          label: "标签",
          control: "text" as const,
          valueKind: "string" as const,
        },
      },
      {
        path: "attachmentId",
        section: "seller",
        label: "附件",
        control: "attachment" as const,
        valueKind: "attachment-id" as const,
        required: false,
        cardinality: "single" as const,
        maxItems: 1,
        descriptorPath: "attachments" as const,
        role: "supporting" as const,
        category: "commercial" as const,
        allowedMediaTypes: ["application/pdf", "image/png", "image/jpeg"] as const,
        pdfPageCount: "user-confirmed" as const,
        includeInSubmissionDefault: false,
      },
    ],
  };
}

function createEditorRegistration(
  factory:
    | ((
        path: string,
        input: { readonly id: string; readonly now: string | Date; readonly draft: TestDraft },
      ) => unknown)
    | null = (_path, input) => ({ id: input.id, name: "新增项目" }),
) {
  const registration = {
    definition: createEditorDefinition(),
    parseDraft(value: unknown): TestDraft {
      const draft = value as TestDraft;
      if (
        draft === null ||
        typeof draft !== "object" ||
        !Array.isArray(draft.items) ||
        draft.items.length < 1 ||
        draft.items.length > 3 ||
        draft.items.some(
          (item) =>
            item === null ||
            typeof item !== "object" ||
            typeof item.id !== "string" ||
            typeof item.name !== "string" ||
            item.name.trim().length === 0,
        )
      ) {
        throw new Error("invalid synthetic draft");
      }
      return structuredClone(draft);
    },
    createDraft: (_input: { id: string; now: string | Date }) => ({
      templateId: "quotation.service.project.v1" as const,
      templateVersion: "1.0.0" as const,
      seller: { legalName: "测试供应商" },
      enabled: true,
      mode: "standard",
      items: [{ id: "item-1", name: "首项" }],
      tags: [],
      attachments: [],
    }),
    compile: () => ({ schemaVersion: "2.0.0" }),
    preflight: () => [],
  };
  if (factory !== null) {
    Object.defineProperty(registration, "createRepeatableItem", {
      configurable: true,
      enumerable: true,
      value: factory,
      writable: true,
    });
  }
  return registration;
}

function assertReadonlyPublicTypes(
  definition: TemplateDefinitionV2,
  registration: TemplateRegistration<TestDraft>,
): void {
  // @ts-expect-error V2 definitions are immutable public values.
  definition.name = "mutated";
  // @ts-expect-error Nested manifest entries are immutable public values.
  definition.fieldManifest[0].label = "mutated";
  // @ts-expect-error Registration properties are immutable while functions remain callable.
  registration.definition = definition;
  registration.parseDraft({});
}
void assertReadonlyPublicTypes;

describe("V2 common schemas", () => {
  it("accepts bounded common values and strips them into isolated outputs", () => {
    const definition = TemplateDefinitionV2Schema.parse(createDefinition());
    const party = EntityPartyV2Schema.parse({
      legalName: "开源商贸（上海）有限公司",
      englishName: "OpenTrad Shanghai Co., Ltd.",
      entityType: "company",
      registrationId: "91310000TEST",
      contactName: "张三",
      email: "sales@example.invalid",
    });
    const localized = LocalizedTextSchema.parse({ zhCN: "交付条款", enUS: "Delivery terms" });

    expect(Object.getPrototypeOf(definition)).toBeNull();
    expect(Object.getPrototypeOf(party)).toBeNull();
    expect(Object.getPrototypeOf(localized)).toBeNull();
    expect(definition.defaultLayout).toBe("modern-business.v1");
    expect(party.contactName).toBe("张三");
  });

  it("rejects unknown ids, versions, mismatched categories and inconsistent defaults", () => {
    expect(() =>
      TemplateDefinitionV2Schema.parse({ ...createDefinition(), id: "quotation.unknown.v1" }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({ ...createDefinition(), version: "1.0.1" }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({ ...createDefinition(), category: "contract" }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...createDefinition(),
        defaultLayout: "international-compact.v1",
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({ ...createDefinition(), defaultLanguage: "en-US" }),
    ).toThrow();
  });

  it("enforces 100-entry arrays, 10,000-character text and safe field paths", () => {
    const field = createDefinition().fieldManifest[0];
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...createDefinition(),
        fieldManifest: Array.from({ length: 101 }, (_, index) => ({
          ...field,
          path: `items.field${index}`,
        })),
      }),
    ).toThrow();
    expect(() => LocalizedTextSchema.parse({ zhCN: "条".repeat(10_001) })).toThrow();
    expect(() =>
      TemplateFieldManifestEntryV1Schema.parse({
        ...field,
        path: "seller.__proto__.legalName",
      }),
    ).toThrow();
    expect(() =>
      TemplateFieldManifestEntryV1Schema.parse({
        ...field,
        options: Array.from({ length: 101 }, (_, index) => ({
          value: String(index),
          label: String(index),
        })),
      }),
    ).toThrow();
  });

  it("accepts bounded discriminated editor metadata while legacy metadata stays optional", () => {
    const legacy = TemplateDefinitionV2Schema.parse(createDefinition());
    const editor = TemplateDefinitionV2Schema.parse(createEditorDefinition());

    expect(legacy.fieldManifest[0]).not.toHaveProperty("valueKind");
    expect(editor.fieldManifest.find((field) => field.path === "mode")).toMatchObject({
      control: "select",
      valueKind: "enum",
      options: [
        { value: "standard", label: "标准" },
        { value: "custom", label: "定制" },
      ],
    });
    expect(editor.fieldManifest.find((field) => field.path === "items")).toMatchObject({
      control: "repeatable",
      valueKind: "object-list",
      minItems: 1,
      maxItems: 3,
      item: {
        kind: "object",
        idPath: "id",
        fields: [{ path: "name", valueKind: "string" }],
      },
    });
    expect(editor.fieldManifest.find((field) => field.path === "attachmentId")).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id",
      cardinality: "single",
      descriptorPath: "attachments",
      role: "supporting",
      category: "commercial",
      pdfPageCount: "user-confirmed",
    });
  });

  it("rejects mismatched controls, empty or duplicate selects and malformed list metadata", () => {
    const definition = createEditorDefinition();
    const byPath = (path: string) =>
      definition.fieldManifest.find((field) => field.path === path) as Record<string, unknown>;
    const replace = (path: string, replacement: Record<string, unknown>) => ({
      ...definition,
      fieldManifest: definition.fieldManifest.map((field) =>
        field.path === path ? replacement : field,
      ),
    });

    expect(() =>
      TemplateDefinitionV2Schema.parse(
        replace("seller.legalName", { ...byPath("seller.legalName"), valueKind: "boolean" }),
      ),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(replace("mode", { ...byPath("mode"), options: [] })),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(
        replace("mode", {
          ...byPath("mode"),
          options: [
            { value: "same", label: "一" },
            { value: "same", label: "二" },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(
        replace("items", { ...byPath("items"), minItems: 4, maxItems: 3 }),
      ),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(
        replace("tags", {
          ...byPath("tags"),
          valueKind: "string-list",
          item: { kind: "object", fields: [] },
        }),
      ),
    ).toThrow();
  });

  it("rejects unsafe paths, oversized editor specs and invalid attachment contracts", () => {
    const definition = createEditorDefinition();
    const items = definition.fieldManifest.find((field) => field.path === "items") as Record<
      string,
      unknown
    >;
    const attachment = definition.fieldManifest.find(
      (field) => field.path === "attachmentId",
    ) as Record<string, unknown>;
    const item = items.item as Record<string, unknown>;
    const objectField = (path: string) => ({
      path,
      label: path,
      control: "text" as const,
      valueKind: "string" as const,
      required: false,
    });

    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: definition.fieldManifest.map((field) =>
          field.path === "items"
            ? { ...items, item: { ...item, fields: [objectField("safe.__proto__.value")] } }
            : field,
        ),
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: definition.fieldManifest.map((field) =>
          field.path === "items"
            ? {
                ...items,
                item: {
                  ...item,
                  fields: Array.from({ length: 101 }, (__, index) => objectField(`field${index}`)),
                },
              }
            : field,
        ),
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: definition.fieldManifest.map((field) =>
          field.path === "items"
            ? { ...items, item: { ...item, fields: [objectField("one.two.three.four.five")] } }
            : field,
        ),
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: Array.from({ length: 5 }, (_, index) => ({
          ...items,
          path: `items${index}`,
          item: {
            ...item,
            fields: Array.from({ length: 100 }, (__, fieldIndex) =>
              objectField(`field${fieldIndex}`),
            ),
          },
        })),
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: definition.fieldManifest.map((field) =>
          field.path === "attachmentId"
            ? {
                ...attachment,
                valueKind: "attachment-id-list",
                cardinality: "single",
                maxItems: 2,
              }
            : field,
        ),
      }),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...definition,
        fieldManifest: definition.fieldManifest.map((field) =>
          field.path === "attachmentId"
            ? { ...attachment, allowedMediaTypes: ["image/gif"] }
            : field,
        ),
      }),
    ).toThrow();
  });

  it("requires visible conditions to reference an exact compatible manifest field", () => {
    const definition = createEditorDefinition();
    const seller = definition.fieldManifest[0] as Record<string, unknown>;
    const withCondition = (visibleWhen: { path: string; equals: string | boolean }) => ({
      ...definition,
      fieldManifest: [{ ...seller, visibleWhen }, ...definition.fieldManifest.slice(1)],
    });

    expect(() =>
      TemplateDefinitionV2Schema.parse(withCondition({ path: "missing", equals: true })),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(withCondition({ path: "enabled", equals: "true" })),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(withCondition({ path: "mode", equals: "unknown" })),
    ).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse(withCondition({ path: "mode", equals: "custom" })),
    ).not.toThrow();
  });

  it("rejects trailing isolated high surrogates in public localized and template text", () => {
    expect(() => LocalizedTextSchema.parse({ zhCN: "无效末尾\ud800" })).toThrow();
    expect(() =>
      TemplateDefinitionV2Schema.parse({
        ...createDefinition(),
        summary: "无效末尾\ud800",
      }),
    ).toThrow();
  });

  it("rejects markup, accessors, cyclic input and custom prototypes without executing getters", () => {
    expect(() =>
      EntityPartyV2Schema.parse({
        legalName: "<script>alert(1)</script>",
        entityType: "company",
        contactName: "张三",
      }),
    ).toThrow();

    const getter = vi.fn(() => "不应执行");
    const hostile = {
      legalName: "安全公司",
      entityType: "company",
      contactName: "李四",
    };
    Object.defineProperty(hostile, "taxId", { enumerable: true, get: getter });
    expect(() => EntityPartyV2Schema.parse(hostile)).toThrow();
    expect(getter).not.toHaveBeenCalled();

    const cyclic: Record<string, unknown> = { zhCN: "循环" };
    cyclic.self = cyclic;
    expect(() => LocalizedTextSchema.parse(cyclic)).toThrow();
    expect(() =>
      EntityPartyV2Schema.parse(
        Object.assign(Object.create({ inherited: true }), {
          legalName: "不安全公司",
          entityType: "company",
          contactName: "王五",
        }),
      ),
    ).toThrow();
  });
});

describe("official template sources", () => {
  it("publishes the exact reviewed primary-source catalogue as immutable data", () => {
    expect(Object.keys(OFFICIAL_SOURCES)).toEqual([
      "samr-contract-library",
      "samr-entrustment-2025",
      "prc-civil-code",
      "mof-order-87",
      "mof-demand-management",
      "prc-tendering-law",
      "ndrc-standard-construction",
      "ndrc-tenderer-responsibility",
      "icc-incoterms-2020",
      "trade-gov-proforma",
      "uncitral-cisg",
    ]);
    expect(OFFICIAL_SOURCES["samr-contract-library"]).toEqual({
      authority: "国家市场监督管理总局",
      title: "全国合同示范文本库",
      url: "https://htsfwb.samr.gov.cn/",
      reviewedAt: "2026-08-19",
    });
    expect(OFFICIAL_SOURCES["trade-gov-proforma"].url).toBe(
      "https://www.trade.gov/pro-forma-invoice",
    );
    expect(OFFICIAL_SOURCES["uncitral-cisg"].url).toBe(
      "https://uncitral.un.org/en/texts/salegoods/conventions/sale_of_goods/cisg",
    );
    expect(Object.isFrozen(OFFICIAL_SOURCES)).toBe(true);
    for (const source of Object.values(OFFICIAL_SOURCES)) {
      expect(source.reviewedAt).toBe("2026-08-19");
      expect(Object.isFrozen(source)).toBe(true);
    }
  });
});

describe("V2 template registry", () => {
  it("dispatches exact id and version and rejects duplicate keys", () => {
    const registration = createRegistration();
    const registry = createTemplateRegistry([registration]);
    const published = registry.get("quotation.service.project.v1", "1.0.0");
    expect(published).toBe(registry.get("quotation.service.project.v1", "1.0.0"));
    expect(published).not.toBe(registration);
    expect(published.parseDraft).toBe(registration.parseDraft);
    expect(() => registry.get("quotation.service.project.v1", "1.0.1")).toThrow("不支持的模板版本");
    expect(() => createTemplateRegistry([registration, createRegistration()])).toThrow(
      "模板版本重复注册",
    );
  });

  it("publishes an isolated immutable snapshot without freezing or mutating caller input", () => {
    const registration = createRegistration();
    const originalDefinition = registration.definition;
    const callerOwnedExtension = { retained: true };
    Object.defineProperty(originalDefinition, "name", {
      configurable: true,
      enumerable: false,
      value: originalDefinition.name,
      writable: true,
    });
    Object.defineProperty(originalDefinition, "callerOwnedExtension", {
      configurable: true,
      enumerable: true,
      value: callerOwnedExtension,
      writable: true,
    });
    const registry = createTemplateRegistry([registration]);
    const published = registry.get("quotation.service.project.v1", "1.0.0");
    const firstList = registry.list();
    const secondList = registry.list();

    expect(firstList).toEqual([published]);
    expect(secondList).toBe(firstList);
    expect(Object.isFrozen(firstList)).toBe(true);
    expect(Object.isFrozen(registration)).toBe(false);
    expect(Object.isFrozen(originalDefinition)).toBe(false);
    expect(Object.isFrozen(callerOwnedExtension)).toBe(false);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.definition)).toBe(true);
    expect(Object.isFrozen(published.definition.languages)).toBe(true);
    expect(Object.isFrozen(published.definition.fieldManifest)).toBe(true);
    expect(Object.isFrozen(published.definition.fieldManifest[0])).toBe(true);
    expect(Object.getPrototypeOf(published)).toBeNull();
    expect(Object.getPrototypeOf(published.definition)).toBeNull();
    expect("callerOwnedExtension" in published.definition).toBe(false);
    const publishedName = Object.getOwnPropertyDescriptor(published.definition, "name");
    expect(publishedName).toMatchObject({
      configurable: false,
      enumerable: true,
      value: "项目/服务报价单",
      writable: false,
    });
    expect("get" in (publishedName ?? {})).toBe(false);
    expect("set" in (publishedName ?? {})).toBe(false);

    (originalDefinition as { name: string }).name = "调用方后续修改";
    expect(published.definition.name).toBe("项目/服务报价单");
    expect(() => {
      (published.definition.languages as string[]).push("en-US");
    }).toThrow();
  });

  it("leaves every caller object mutable when validation or duplicate detection fails", () => {
    const validBeforeFailure = createRegistration();
    const invalid = {
      ...createRegistration(),
      definition: { ...createDefinition(), id: "quotation.unknown.v1" },
    } as never;

    expect(() => createTemplateRegistry([validBeforeFailure, invalid])).toThrow("模板定义无效");
    expect(Object.isFrozen(validBeforeFailure)).toBe(false);
    expect(Object.isFrozen(validBeforeFailure.definition)).toBe(false);
    expect(Object.isFrozen(validBeforeFailure.definition.languages)).toBe(false);

    const duplicateA = createRegistration();
    const duplicateB = createRegistration();
    expect(() => createTemplateRegistry([duplicateA, duplicateB])).toThrow("模板版本重复注册");
    expect(Object.isFrozen(duplicateA)).toBe(false);
    expect(Object.isFrozen(duplicateA.definition)).toBe(false);
    expect(Object.isFrozen(duplicateB)).toBe(false);
    expect(Object.isFrozen(duplicateB.definition)).toBe(false);
  });

  it("validates definitions and rejects accessor-based registration input without executing it", () => {
    const invalid = {
      ...createRegistration(),
      definition: { ...createDefinition(), id: "quotation.unknown.v1" },
    } as never;
    expect(() => createTemplateRegistry([invalid])).toThrow("模板定义无效");

    const getter = vi.fn(() => createDefinition());
    const hostile = {
      parseDraft: (value: unknown) => value,
      createDraft: () => ({}),
      compile: () => ({}),
      preflight: () => [],
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "definition", { enumerable: true, get: getter });
    expect(() => createTemplateRegistry([hostile as never])).toThrow("模板注册无效");
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not coerce hostile lookup values into registry keys", () => {
    const registry = createTemplateRegistry([createRegistration()]);
    const stringifyAttempt = vi.fn(() => "quotation.service.project.v1");
    expect(() => registry.get({ toString: stringifyAttempt } as never, "1.0.0")).toThrow(
      "不支持的模板版本",
    );
    expect(stringifyAttempt).not.toHaveBeenCalled();
  });

  it("publishes a frozen repeatable factory that trusts only an inserted parsed item", () => {
    const registration = createEditorRegistration();
    const registry = createTemplateRegistry([registration as never]);
    const published = registry.get("quotation.service.project.v1", "1.0.0") as unknown as {
      createRepeatableItem: (
        path: string,
        input: { id: string; now: string | Date; draft: TestDraft },
      ) => unknown;
    };
    const draft = registration.createDraft({ id: "draft-1", now: "2026-08-20T00:00:00Z" });

    const item = published.createRepeatableItem("items", {
      id: "item-2",
      now: "2026-08-20T00:00:00Z",
      draft,
    });

    expect(item).toEqual({ id: "item-2", name: "新增项目" });
    expect(Object.isFrozen(item)).toBe(true);
    expect(draft.items).toEqual([{ id: "item-1", name: "首项" }]);
    expect(Object.isFrozen(published)).toBe(true);
    const definition = (published as unknown as { definition: TemplateDefinitionV2 }).definition;
    const mode = definition.fieldManifest.find((field) => field.path === "mode") as {
      options?: readonly unknown[];
    };
    const items = definition.fieldManifest.find((field) => field.path === "items") as {
      item?: { fields?: readonly unknown[] };
    };
    const attachment = definition.fieldManifest.find((field) => field.path === "attachmentId") as {
      allowedMediaTypes?: readonly string[];
    };
    expect(Object.isFrozen(mode.options)).toBe(true);
    expect(Object.isFrozen(items.item)).toBe(true);
    expect(Object.isFrozen(items.item?.fields)).toBe(true);
    expect(Object.isFrozen(attachment.allowedMediaTypes)).toBe(true);
  });

  it("rejects unknown, non-repeatable and missing repeatable factories before dispatch", () => {
    const factory = vi.fn((_path: string, input: { id: string }) => ({
      id: input.id,
      name: "新增项目",
    }));
    const published = createTemplateRegistry([
      createEditorRegistration(factory as never) as never,
    ]).get("quotation.service.project.v1", "1.0.0") as unknown as {
      createRepeatableItem: (path: string, input: Record<string, unknown>) => unknown;
    };
    const draft = createEditorRegistration().createDraft({
      id: "draft-1",
      now: "2026-08-20T00:00:00Z",
    });
    const input = { id: "item-2", now: "2026-08-20T00:00:00Z", draft };

    expect(() => published.createRepeatableItem("missing", input)).toThrow();
    expect(() => published.createRepeatableItem("seller.legalName", input)).toThrow();
    expect(factory).not.toHaveBeenCalled();

    const withoutFactory = createTemplateRegistry([createEditorRegistration(null) as never]).get(
      "quotation.service.project.v1",
      "1.0.0",
    ) as unknown as {
      createRepeatableItem: (path: string, input: Record<string, unknown>) => unknown;
    };
    expect(typeof withoutFactory.createRepeatableItem).toBe("function");
    expect(() => withoutFactory.createRepeatableItem("items", input)).toThrow();
  });

  it("rejects invalid factory results through the candidate draft parser", () => {
    const published = createTemplateRegistry([
      createEditorRegistration((_path, input) => ({ id: input.id, name: "" })) as never,
    ]).get("quotation.service.project.v1", "1.0.0") as unknown as {
      createRepeatableItem: (path: string, input: Record<string, unknown>) => unknown;
    };
    const registration = createEditorRegistration();
    const draft = registration.createDraft({ id: "draft-1", now: "2026-08-20T00:00:00Z" });

    expect(() =>
      published.createRepeatableItem("items", {
        id: "item-2",
        now: "2026-08-20T00:00:00Z",
        draft,
      }),
    ).toThrow();
  });

  it("rejects accessor repeatable factories without executing them", () => {
    const getter = vi.fn(() => () => ({ id: "item-2", name: "不应执行" }));
    const registration = createEditorRegistration(null);
    Object.defineProperty(registration, "createRepeatableItem", { enumerable: true, get: getter });

    expect(() => createTemplateRegistry([registration as never])).toThrow("模板注册无效");
    expect(getter).not.toHaveBeenCalled();
  });
});
