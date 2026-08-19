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
    createDraft: () => ({
      templateId: "quotation.service.project.v1",
      templateVersion: "1.0.0",
    }),
    compile: () => ({ schemaVersion: "2.0.0" }),
    preflight: () => [],
  };
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
});
