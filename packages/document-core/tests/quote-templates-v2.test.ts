import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { STANDARD_GOODS_QUOTE_TEMPLATE } from "../src/index.js";
import {
  DocumentModelV2Schema,
  RiskFindingV2Schema,
  type TemplateFieldManifestEntryV1,
} from "../src/v2/index.js";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index.js";

const SERVICE_SECTIONS = [
  "title",
  "quote-meta",
  "parties",
  "project-overview",
  "scope",
  "service-lines",
  "milestones",
  "totals",
  "assumptions",
  "exclusions",
  "delivery-acceptance",
  "payment-expenses",
  "ip-confidentiality",
  "quote-notice",
  "signature",
] as const;

const OEM_SECTIONS = [
  "title",
  "quote-meta",
  "parties",
  "oem-basis",
  "technical-basis",
  "charge-lines",
  "totals",
  "sample-and-leadtime",
  "tooling",
  "materials",
  "quality-acceptance",
  "change-ip-confidentiality",
  "delivery-payment-warranty",
  "quote-notice",
  "signature",
] as const;

const EXPORT_SECTIONS = [
  "bilingual-title",
  "quote-meta",
  "bilingual-parties",
  "goods-table",
  "totals",
  "trade-term",
  "transport-shipment",
  "packaging-inspection",
  "payment-bank-charges",
  "document-list",
  "language-priority",
  "incoterms-notice",
  "signature",
] as const;

const PROFORMA_SECTIONS = [
  "proforma-banner",
  "invoice-meta",
  "exporter-importer",
  "consignee-notify",
  "goods-table",
  "weights-dimensions",
  "charges",
  "totals",
  "sale-term",
  "payment-shipping",
  "bank-instructions",
  "proforma-declaration",
  "signature",
] as const;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

const RESERVED_FIELD_PATHS = new Set(["id", "templateId", "templateVersion", "updatedAt"]);

function draftPath(input: unknown, path: string): { exists: boolean; value: unknown } {
  let current = input;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function setDraftPath(input: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  const leaf = segments.pop();
  if (!leaf) throw new Error("Missing field path leaf");
  let current = input;
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new Error(`Missing field path parent: ${path}`);
    }
    current = next as Record<string, unknown>;
  }
  current[leaf] = value;
}

function editedFieldValue(field: TemplateFieldManifestEntryV1, current: unknown): unknown {
  if (field.valueKind === "localized-text") {
    expect(current).not.toBeNull();
    expect(typeof current).toBe("object");
    const localized = structuredClone(current) as Record<string, unknown>;
    expect(typeof localized.zhCN).toBe("string");
    localized.zhCN = `${localized.zhCN}（已编辑）`;
    if (typeof localized.enUS === "string") localized.enUS = `${localized.enUS} (edited)`;
    return localized;
  }
  if (field.valueKind === "decimal-string") {
    expect(typeof current).toBe("string");
    return (Number(current) + 0.001).toString();
  }
  switch (field.control) {
    case "text":
    case "textarea":
      expect(typeof current).toBe("string");
      return `${current as string}（已编辑）`;
    case "date":
      expect(typeof current).toBe("string");
      return field.path === "meta.issueDate" ? "2026-08-18" : "2026-09-17";
    case "datetime":
      expect(typeof current).toBe("string");
      return "2026-09-17T00:00:00.000Z";
    case "checkbox":
      expect(typeof current).toBe("boolean");
      return !current;
    case "repeatable":
      expect(Array.isArray(current)).toBe(true);
      return editRepeatableField(current as unknown[]);
    case "select": {
      expect(typeof current).toBe("string");
      expect(field.options?.length).toBeGreaterThan(0);
      expect(field.options?.map((option) => option.value)).toContain(current);
      return field.options?.find((option) => option.value !== current)?.value ?? current;
    }
    case "attachment":
      throw new Error(`Attachment mutation requires a real second reference: ${field.path}`);
    case "number":
    case "percent":
      expect(typeof current).toBe("number");
      return (current as number) + 1;
    case "money":
      expect(typeof current).toBe("string");
      return (BigInt(current as string) + 1n).toString();
  }
}

function editRepeatableField(current: unknown[]): unknown[] {
  const replacement = structuredClone(current);
  const first = replacement[0];
  expect(first).toBeDefined();
  expect(first).not.toBeNull();
  expect(typeof first).toBe("object");
  const record = first as Record<string, unknown>;
  for (const key of ["serviceName", "title", "name", "label", "description", "deliverable"]) {
    if (typeof record[key] === "string") {
      record[key] = `${record[key]}（已编辑）`;
      return replacement;
    }
    const localized = record[key];
    if (
      localized !== null &&
      typeof localized === "object" &&
      typeof (localized as Record<string, unknown>).zhCN === "string"
    ) {
      const localizedRecord = localized as Record<string, unknown>;
      localizedRecord.zhCN = `${localizedRecord.zhCN}（已编辑）`;
      return replacement;
    }
  }
  if (typeof record.zhCN === "string") {
    record.zhCN = `${record.zhCN}（已编辑）`;
    return replacement;
  }
  throw new Error("Repeatable field has no safely editable descriptive value");
}

function verifyFieldManifest(input: {
  id:
    | "quotation.service.project.v1"
    | "quotation.oem.custom.v1"
    | "quotation.export.bilingual.v1"
    | "quotation.proforma.invoice.v1";
  fixtureName: string;
  expectedPaths: readonly string[];
  expectedSelectOptions: Readonly<Record<string, readonly string[]>>;
}): void {
  const registration = V2_TEMPLATE_REGISTRY.get(input.id, "1.0.0");
  const fields = registration.definition.fieldManifest;
  const paths = fields.map((field) => field.path);
  expect(fields.length).toBeGreaterThan(5);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths.some((path) => RESERVED_FIELD_PATHS.has(path))).toBe(false);
  expect([...paths].sort()).toEqual([...input.expectedPaths].sort());
  expect(
    fields
      .filter((field) => field.control === "select")
      .map((field) => field.path)
      .sort(),
  ).toEqual(Object.keys(input.expectedSelectOptions).sort());

  const base = registration.parseDraft(fixture(input.fixtureName));
  const sections = new Set(
    DocumentModelV2Schema.parse(registration.compile(base)).sections.map((section) => section.id),
  );
  for (const field of fields) {
    expect(field.valueKind, `${input.id}:${field.path}:valueKind`).toBeDefined();
    expect(sections.has(field.section)).toBe(true);
    const current = draftPath(base, field.path);
    if (!current.exists) {
      expect(field.required, `${input.id}:${field.path}:missing optional path`).toBe(false);
      continue;
    }
    if (field.required) {
      expect(current.value).not.toBeUndefined();
      if (typeof current.value === "string") expect(current.value.trim().length).toBeGreaterThan(0);
      if (Array.isArray(current.value)) expect(current.value.length).toBeGreaterThan(0);
    }
    if (field.control !== "select") expect(field.options).toBeUndefined();
    if (field.control === "select") {
      expect(field.options?.map((option) => option.value)).toEqual(
        input.expectedSelectOptions[field.path],
      );
      for (const option of field.options ?? []) {
        const optionDraft = structuredClone(base) as Record<string, unknown>;
        setDraftPath(optionDraft, field.path, option.value);
        const optionParsed = registration.parseDraft(optionDraft);
        expect(draftPath(optionParsed, field.path)).toEqual({
          exists: true,
          value: option.value,
        });
      }
    }
    if (field.visibleWhen) {
      const condition = draftPath(base, field.visibleWhen.path);
      expect(condition.exists).toBe(true);
      expect(typeof condition.value).toBe(typeof field.visibleWhen.equals);
    }
    const edited = structuredClone(base) as Record<string, unknown>;
    const replacement = editedFieldValue(field, current.value);
    expect(replacement).not.toEqual(current.value);
    setDraftPath(edited, field.path, replacement);
    const parsed = registration.parseDraft(edited);
    expect(draftPath(parsed, field.path)).toEqual({ exists: true, value: replacement });
  }
}

describe("quotation.service.project.v1", () => {
  it("registers the exact immutable identity and compiles the fixture in stable order", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("quotation-service-project"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));

    expect(registration).toBe(V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0"));
    expect(registration.definition).toMatchObject({
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLanguage: "zh-CN",
      defaultLayout: "modern-business.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
    });
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.definition)).toBe(true);
    expect(model.sections.map((section) => section.id)).toEqual(SERVICE_SECTIONS);
    expect(model.sections.some((section) => section.id === "disclaimer")).toBe(false);
    expect(model.disclaimers).toEqual(["quotation-non-advice"]);
    expect(JSON.stringify(model)).toContain("CNY 463.75");
    expect(JSON.stringify(model)).toContain("未约定");
    expect(Object.isFrozen(model)).toBe(true);
  });

  it("creates a UTC, real-calendar local draft and reparses every public operation", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const draft = registration.createDraft({
      id: "service-created",
      now: "2028-02-29T23:30:00.000-08:00",
    });
    const draftRecord = draft as Record<string, unknown>;
    const parsed = registration.parseDraft(draft) as {
      meta: Record<string, unknown>;
    };
    expect(parsed.meta).toMatchObject({
      issueDate: "2028-03-01",
      validUntil: "2028-03-31",
      currency: "CNY",
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    });
    expect(registration.definition.languages).toEqual(["zh-CN"]);
    expect(() =>
      registration.parseDraft({
        ...draftRecord,
        meta: {
          ...parsed.meta,
          language: "zh-en",
          englishTitle: "Project Service Quotation",
        },
      }),
    ).toThrow();
    expect(() => registration.compile({ ...draftRecord, unexpected: true })).toThrow();
    expect(() => registration.preflight({ ...draftRecord, unexpected: true })).toThrow();
    expect(() =>
      registration.parseDraft({ ...draftRecord, updatedAt: "not-an-instant" }),
    ).toThrow();
  });

  it("emits exact service findings from the same analysis used for watermarks", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-service-project")) as Record<
      string,
      unknown
    >;
    const meta = base.meta as Record<string, unknown>;
    const terms = base.terms as Record<string, unknown>;
    const risky = {
      ...base,
      meta: { ...meta, quoteNature: "binding-offer" },
      terms: { ...terms, duration: "", acceptance: "", payment: "" },
      dataHandling: { personalDataInvolved: true },
      milestones: [
        {
          id: "milestone-1",
          title: "一期",
          deliverable: "方案",
          dueDescription: "合同后十日",
          acceptanceCriteria: "书面确认",
          paymentBps: 4000,
        },
        {
          id: "milestone-2",
          title: "二期",
          deliverable: "报告",
          dueDescription: "一期后十日",
          acceptanceCriteria: "书面确认",
        },
      ],
    };
    const findings = registration.preflight(risky);
    expect(findings.map((finding) => [finding.code, finding.impact])).toEqual([
      ["SERVICE_BINDING_DURATION_MISSING", "blockSubmission"],
      ["SERVICE_BINDING_ACCEPTANCE_MISSING", "blockSubmission"],
      ["SERVICE_BINDING_PAYMENT_MISSING", "blockSubmission"],
      ["SERVICE_PERSONAL_DATA_TERMS_MISSING", "blockSubmission"],
      ["SERVICE_MILESTONE_PAYMENT_INCOMPLETE", "watermark"],
    ]);
    expect(findings.map((finding) => RiskFindingV2Schema.parse(finding))).toEqual(findings);
    expect(findings.every(Object.isFrozen)).toBe(true);
    const model = DocumentModelV2Schema.parse(registration.compile(risky));
    expect(model.watermarks.map((watermark) => watermark.id)).toEqual(["review-required"]);
  });

  it("validates milestone ids, references and payment proportions structurally", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-service-project")) as Record<
      string,
      unknown
    >;
    const milestones = base.milestones as unknown[];
    const serviceLines = base.serviceLines as Array<Record<string, unknown>>;
    expect(() =>
      registration.parseDraft({ ...base, milestones: [milestones[0], milestones[0]] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        serviceLines: [{ ...serviceLines[0], milestoneId: "missing" }],
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        milestones: [{ ...(milestones[0] as object), paymentBps: 10_001 }],
      }),
    ).toThrow();
  });

  it("fails closed for hostile unknown, accessor, sparse, prototype, revoked and budget input", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const base = fixture("quotation-service-project") as Record<string, unknown>;
    expect(() => registration.parseDraft({ ...base, unknown: true })).toThrow();

    const getter = vi.fn(() => "不应执行");
    const accessor = { ...base };
    Object.defineProperty(accessor, "terms", { enumerable: true, get: getter });
    expect(() => registration.parseDraft(accessor)).toThrow();
    expect(getter).not.toHaveBeenCalled();

    const sparse = new Array(1);
    expect(() => registration.parseDraft({ ...base, milestones: sparse })).toThrow();
    expect(() =>
      registration.parseDraft(Object.assign(Object.create({ inherited: true }), base)),
    ).toThrow();
    const { proxy, revoke } = Proxy.revocable(base, {});
    revoke();
    expect(() => registration.parseDraft(proxy)).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        project: {
          ...(base.project as object),
          objective: "项".repeat(20_000),
        },
      }),
    ).toThrow();
  });

  it("keeps the V1 quotation identity frozen and unchanged", () => {
    expect(STANDARD_GOODS_QUOTE_TEMPLATE).toEqual({
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      category: "quotation",
      name: "标准货物报价单",
      supportedCurrencies: ["CNY", "USD", "EUR"],
    });
    expect(Object.isFrozen(STANDARD_GOODS_QUOTE_TEMPLATE)).toBe(true);
  });
});

describe("quotation.oem.custom.v1", () => {
  it("parses the fixture, calculates exact charges and compiles fifteen stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.oem.custom.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("quotation-oem-custom"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "quotation.oem.custom.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLanguage: "zh-CN",
      defaultLayout: "modern-business.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
    });
    expect(model.sections.map((section) => section.id)).toEqual(OEM_SECTIONS);
    expect(model.sections.some((section) => section.id === "disclaimer")).toBe(false);
    expect(model.disclaimers).toEqual(["quotation-non-advice"]);
    expect(JSON.stringify(model)).toContain("CNY 1,695.00");
  });

  it("enforces strict dense unique 1..100 charge lines and reparses compile/preflight", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.oem.custom.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-oem-custom")) as Record<
      string,
      unknown
    >;
    const lines = base.chargeLines as Array<Record<string, unknown>>;
    expect(() => registration.parseDraft({ ...base, chargeLines: [] })).toThrow();
    expect(() => registration.parseDraft({ ...base, chargeLines: [lines[0], lines[0]] })).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        chargeLines: Array.from({ length: 101 }, (_, index) => ({
          ...lines[0],
          id: `charge-${index}`,
        })),
      }),
    ).toThrow();
    expect(() => registration.compile({ ...base, unexpected: true })).toThrow();
    const sparse = new Array(1);
    expect(() => registration.preflight({ ...base, chargeLines: sparse })).toThrow();
  });

  it("emits exact ownership, material, IP, change and consistency findings", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.oem.custom.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-oem-custom")) as Record<
      string,
      unknown
    >;
    const project = base.project as Record<string, unknown>;
    const terms = base.terms as Record<string, unknown>;
    const risky = {
      ...base,
      project: { ...project, buyerSuppliedMaterials: true },
      terms: {
        ...terms,
        toolingRequired: false,
        toolingOwnership: "",
        materialReceiptAndReturn: "",
        intellectualProperty: "",
        engineeringChange: "",
      },
    };
    const findings = registration.preflight(risky);
    expect(findings.map((finding) => [finding.code, finding.impact])).toEqual([
      ["OEM_TOOLING_FLAG_INCONSISTENT", "blockSubmission"],
      ["OEM_TOOLING_OWNERSHIP_MISSING", "blockSubmission"],
      ["OEM_BUYER_MATERIAL_TERMS_MISSING", "blockSubmission"],
      ["OEM_IP_TERMS_MISSING", "watermark"],
      ["OEM_CHANGE_CONTROL_MISSING", "watermark"],
    ]);
    expect(findings.every(Object.isFrozen)).toBe(true);
    const model = DocumentModelV2Schema.parse(registration.compile(risky));
    expect(model.watermarks.map((watermark) => watermark.id)).toEqual(["review-required"]);
  });

  it("keeps tooling ownership editable when an NRE-only charge still blocks without it", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.oem.custom.v1", "1.0.0");
    const ownershipField = registration.definition.fieldManifest.find(
      (field) => field.path === "terms.toolingOwnership",
    );
    expect(ownershipField).toBeDefined();
    expect(ownershipField).not.toHaveProperty("visibleWhen");

    const base = registration.parseDraft(fixture("quotation-oem-custom")) as Record<
      string,
      unknown
    >;
    const chargeLines = base.chargeLines as Array<Record<string, unknown>>;
    const terms = base.terms as Record<string, unknown>;
    const nreOnly = {
      ...base,
      chargeLines: [
        chargeLines[0],
        {
          ...chargeLines[1],
          id: "nre-design",
          chargeType: "nre",
          name: "工程设计 NRE",
        },
      ],
      terms: { ...terms, toolingRequired: false, toolingOwnership: "" },
    };
    expect(
      registration
        .preflight(nreOnly)
        .filter((finding) => finding.impact === "blockSubmission")
        .map((finding) => finding.code),
    ).toEqual(["OEM_TOOLING_OWNERSHIP_MISSING"]);
  });

  it("creates a local CNY draft without inventing ownership or material terms", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.oem.custom.v1", "1.0.0");
    const draft = registration.createDraft({ id: "oem-created", now: "2026-08-19T12:00:00Z" });
    const parsed = registration.parseDraft(draft) as {
      meta: Record<string, unknown>;
      terms: Record<string, unknown>;
    };
    expect(parsed.meta).toMatchObject({
      issueDate: "2026-08-19",
      validUntil: "2026-09-18",
      currency: "CNY",
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    });
    expect(registration.definition.languages).toEqual(["zh-CN"]);
    expect(() =>
      registration.parseDraft({
        ...(draft as Record<string, unknown>),
        meta: {
          ...parsed.meta,
          language: "en-US",
          englishTitle: "OEM Custom Quotation",
        },
      }),
    ).toThrow();
    expect(parsed.terms.toolingOwnership).toBeUndefined();
    expect(parsed.terms.materialReceiptAndReturn).toBeUndefined();
    expect(registration.preflight(draft).some((finding) => finding.impact === "watermark")).toBe(
      true,
    );
  });
});

describe("quotation.export.bilingual.v1", () => {
  it("locks zh-en, USD and international layout and compiles thirteen stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.export.bilingual.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("quotation-export-bilingual"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "quotation.export.bilingual.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLanguage: "zh-en",
      defaultLayout: "international-compact.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
    });
    expect(model.language).toBe("zh-en");
    expect(model.sections.map((section) => section.id)).toEqual(EXPORT_SECTIONS);
    expect(model.sections.some((section) => section.id === "disclaimer")).toBe(false);
    expect(model.disclaimers).toEqual(["international-choice-warning"]);
    expect(JSON.stringify(model)).toContain("USD 250.00");
    expect(JSON.stringify(model)).toContain("Incoterms 2020");
  });

  it("projects partial-shipment and transshipment choices into the semantic model", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.export.bilingual.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-export-bilingual")) as Record<
      string,
      unknown
    >;
    const trade = base.trade as Record<string, unknown>;
    const transportSection = (partialShipment: boolean, transshipment: boolean) => {
      const model = DocumentModelV2Schema.parse(
        registration.compile({
          ...base,
          trade: { ...trade, partialShipment, transshipment },
        }),
      );
      return model.sections.find((section) => section.id === "transport-shipment");
    };

    const prohibited = transportSection(false, false);
    const allowed = transportSection(true, true);
    expect(prohibited).toMatchObject({
      blocks: [
        {
          id: "export-transport-grid",
          entries: expect.arrayContaining([
            {
              id: "partial-shipment",
              label: { zhCN: "分批装运", enUS: "Partial Shipment" },
              value: { zhCN: "不允许", enUS: "Not allowed" },
            },
            {
              id: "transshipment",
              label: { zhCN: "转运", enUS: "Transshipment" },
              value: { zhCN: "不允许", enUS: "Not allowed" },
            },
          ]),
        },
      ],
    });
    expect(allowed).toMatchObject({
      blocks: [
        {
          id: "export-transport-grid",
          entries: expect.arrayContaining([
            {
              id: "partial-shipment",
              label: { zhCN: "分批装运", enUS: "Partial Shipment" },
              value: { zhCN: "允许", enUS: "Allowed" },
            },
            {
              id: "transshipment",
              label: { zhCN: "转运", enUS: "Transshipment" },
              value: { zhCN: "允许", enUS: "Allowed" },
            },
          ]),
        },
      ],
    });
    expect(allowed).not.toEqual(prohibited);
  });

  it("requires authored English for parties, items and every commercial term", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.export.bilingual.v1", "1.0.0");
    const base = fixture("quotation-export-bilingual") as Record<string, unknown>;
    const seller = base.seller as Record<string, unknown>;
    const legalName = seller.legalName as Record<string, unknown>;
    expect(() =>
      registration.parseDraft({
        ...base,
        seller: { ...seller, legalName: { zhCN: legalName.zhCN } },
      }),
    ).toThrow();
    const trade = base.trade as Record<string, unknown>;
    const payment = trade.paymentMethod as Record<string, unknown>;
    expect(() =>
      registration.parseDraft({
        ...base,
        trade: { ...trade, paymentMethod: { zhCN: payment.zhCN } },
      }),
    ).toThrow();
    expect(() => registration.compile({ ...base, unexpected: true })).toThrow();
  });

  it("emits exact insurance, sea-mode, port, HS and language-priority findings", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.export.bilingual.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-export-bilingual")) as Record<
      string,
      unknown
    >;
    const trade = base.trade as Record<string, unknown>;
    const risky = {
      ...base,
      trade: {
        ...trade,
        transportMode: "air",
        portOfLoading: undefined,
        portOfDischarge: undefined,
        insuranceArrangement: undefined,
        languagePriority: undefined,
      },
    };
    const findings = registration.preflight(risky);
    expect(findings.map((finding) => [finding.code, finding.impact])).toEqual([
      ["INCOTERMS_CIF_CIP_INSURANCE_MISSING", "blockSubmission"],
      ["INCOTERMS_SEA_MODE_REQUIRED", "blockSubmission"],
      ["INCOTERMS_PORT_MISSING", "blockSubmission"],
      ["HS_CODE_USER_SUPPLIED_UNVERIFIED", "advisory"],
      ["LANGUAGE_PRIORITY_MISSING", "blockSubmission"],
    ]);
    expect(findings.every(Object.isFrozen)).toBe(true);
    const model = DocumentModelV2Schema.parse(registration.compile(risky));
    expect(model.watermarks.map((watermark) => watermark.id)).toEqual(["review-required"]);
  });

  it("advises EXW/DDP without choosing either rule and never derives customs or tax", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.export.bilingual.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-export-bilingual")) as Record<
      string,
      unknown
    >;
    const trade = base.trade as Record<string, unknown>;
    expect(
      registration
        .preflight({ ...base, trade: { ...trade, incotermsRule: "EXW" } })
        .map((finding) => finding.code),
    ).toContain("INCOTERMS_EXW_CLEARANCE_ADVISORY");
    expect(
      registration
        .preflight({ ...base, trade: { ...trade, incotermsRule: "DDP" } })
        .map((finding) => finding.code),
    ).toContain("INCOTERMS_DDP_IMPORT_ADVISORY");

    const created = registration.createDraft({
      id: "export-created",
      now: "2026-08-19T00:00:00Z",
    });
    const parsed = registration.parseDraft(created) as {
      meta: Record<string, unknown>;
      trade: Record<string, unknown>;
    };
    expect(parsed.meta).toMatchObject({
      currency: "USD",
      language: "zh-en",
      layoutStyleId: "international-compact.v1",
    });
    expect(parsed.trade.incotermsRule).toBeUndefined();
    expect(parsed.trade.namedPlace).toBeUndefined();
    expect(parsed.trade.languagePriority).toBeUndefined();
    expect(
      registration.preflight(created).map((finding) => [finding.code, finding.impact]),
    ).toEqual(
      expect.arrayContaining([
        ["INCOTERMS_SELECTION_MISSING", "blockSubmission"],
        ["LANGUAGE_PRIORITY_MISSING", "blockSubmission"],
      ]),
    );
    expect(JSON.stringify(created)).not.toMatch(/derivedTax|verifiedHs|translated/);
  });
});

describe("quotation.proforma.invoice.v1", () => {
  it("compiles exact adjustments and the corrected declaration in thirteen sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.proforma.invoice.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("quotation-proforma-invoice"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "quotation.proforma.invoice.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLanguage: "zh-en",
      defaultLayout: "international-compact.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
    });
    expect(model.sections.map((section) => section.id)).toEqual(PROFORMA_SECTIONS);
    expect(model.sections.some((section) => section.id === "disclaimer")).toBe(false);
    expect(model.disclaimers).toEqual(["international-choice-warning"]);
    expect(JSON.stringify(model)).toContain("USD 325.00");
    expect(JSON.stringify(model)).toContain(
      "不替代税务发票、正式商业发票、付款凭证或运输单据，具体机构要求为准",
    );
  });

  it("uses meta.validUntil as the only validity source and keeps insurance independent", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.proforma.invoice.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-proforma-invoice")) as Record<
      string,
      unknown
    >;
    const shipment = base.shipment as Record<string, unknown>;
    expect(Object.hasOwn(shipment, "validityDate")).toBe(false);
    expect(Object.hasOwn(shipment, "transportMode")).toBe(true);
    expect(Object.hasOwn(shipment, "insuranceArrangement")).toBe(true);
    expect(() =>
      registration.parseDraft({
        ...base,
        shipment: { ...shipment, validityDate: "2026-09-30" },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        shipment: { ...shipment, totalGrossWeightKg: "9", totalNetWeightKg: "10" },
      }),
    ).toThrow();
  });

  it("calls proforma adjustments without automatically taxing freight or other charges", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.proforma.invoice.v1", "1.0.0");
    const base = fixture("quotation-proforma-invoice") as Record<string, unknown>;
    const model = DocumentModelV2Schema.parse(registration.compile(base));
    const serialized = JSON.stringify(model);
    expect(serialized).toContain("USD 10.00");
    expect(serialized).toContain("USD 50.00");
    expect(serialized).toContain("USD 25.00");
    expect(serialized).toContain("USD 325.00");
    expect(serialized).not.toMatch(/freightTax|insuranceTax|otherChargesTax/);
    expect(() => registration.preflight({ ...base, unexpected: true })).toThrow();
  });

  it("emits bank, HS and shared international findings with no silent selections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("quotation.proforma.invoice.v1", "1.0.0");
    const base = registration.parseDraft(fixture("quotation-proforma-invoice")) as Record<
      string,
      unknown
    >;
    expect(registration.preflight(base).map((finding) => [finding.code, finding.impact])).toEqual([
      ["HS_CODE_USER_SUPPLIED_UNVERIFIED", "advisory"],
      ["BANK_INSTRUCTIONS_USER_SUPPLIED_UNVERIFIED", "advisory"],
    ]);
    const created = registration.createDraft({ id: "pi-created", now: "2028-01-31T23:00:00Z" });
    const parsed = registration.parseDraft(created) as {
      meta: Record<string, unknown>;
      shipment: Record<string, unknown>;
    };
    expect(parsed.meta).toMatchObject({
      issueDate: "2028-01-31",
      validUntil: "2028-03-01",
      currency: "USD",
      language: "zh-en",
      layoutStyleId: "international-compact.v1",
    });
    expect(parsed.shipment.incotermsRule).toBeUndefined();
    expect(parsed.shipment.namedPlace).toBeUndefined();
    expect(parsed.shipment.languagePriority).toBeUndefined();
    expect(
      registration.preflight(created).map((finding) => [finding.code, finding.impact]),
    ).toEqual(
      expect.arrayContaining([
        ["INCOTERMS_SELECTION_MISSING", "blockSubmission"],
        ["LANGUAGE_PRIORITY_MISSING", "blockSubmission"],
      ]),
    );
  });
});

describe("versioned quotation field manifests", () => {
  const COMMON_META_PATHS = [
    "meta.number",
    "meta.title",
    "meta.englishTitle",
    "meta.issueDate",
    "meta.validUntil",
    "meta.taxMode",
    "meta.quoteNature",
  ] as const;
  const PARTY_KEYS = [
    "legalName",
    "englishName",
    "entityType",
    "registrationId",
    "taxId",
    "registeredAddress",
    "postalAddress",
    "legalRepresentative",
    "authorizedRepresentative",
    "contactName",
    "phone",
    "email",
    "bankAccountName",
    "bankName",
    "bankAccount",
    "swiftCode",
  ] as const;
  const BILINGUAL_PARTY_KEYS = [
    "legalName",
    "entityType",
    "registrationId",
    "registeredAddress",
    "contactName",
    "phone",
    "email",
  ] as const;
  const partyPaths = (prefix: string) => PARTY_KEYS.map((key) => `${prefix}.${key}`);
  const bilingualPartyPaths = (prefix: string) =>
    BILINGUAL_PARTY_KEYS.map((key) => `${prefix}.${key}`);
  const entityOptions = ["company", "organization", "individual"] as const;
  const taxModeOptions = ["tax-excluded", "tax-included", "tax-exempt"] as const;
  const quoteNatureOptions = ["invitation", "binding-offer"] as const;
  const transportOptions = ["air", "road", "rail", "sea", "multimodal"] as const;
  const incotermsOptions = [
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
  ] as const;
  const cases = [
    {
      id: "quotation.service.project.v1",
      fixtureName: "quotation-service-project",
      expectedPaths: [
        ...COMMON_META_PATHS,
        "meta.currency",
        ...partyPaths("seller"),
        ...partyPaths("buyer"),
        ...["projectName", "buyerReference", "objective", "scope", "assumptions", "exclusions"].map(
          (key) => `project.${key}`,
        ),
        "serviceLines",
        "milestones",
        ...[
          "startDate",
          "duration",
          "serviceLocation",
          "customerDependencies",
          "expensePolicy",
          "acceptance",
          "payment",
          "intellectualProperty",
          "confidentiality",
          "changeControl",
          "notes",
        ].map((key) => `terms.${key}`),
        "dataHandling.personalDataInvolved",
        "dataHandling.processingTerms",
      ],
      expectedSelectOptions: {
        "meta.currency": ["CNY", "USD", "EUR"],
        "meta.taxMode": taxModeOptions,
        "meta.quoteNature": quoteNatureOptions,
        "seller.entityType": entityOptions,
        "buyer.entityType": entityOptions,
      },
      repeatablePaths: ["serviceLines", "milestones"],
    },
    {
      id: "quotation.oem.custom.v1",
      fixtureName: "quotation-oem-custom",
      expectedPaths: [
        ...COMMON_META_PATHS,
        "meta.currency",
        ...partyPaths("seller"),
        ...partyPaths("buyer"),
        ...[
          "projectName",
          "productName",
          "customerModel",
          "drawingVersion",
          "sampleBasis",
          "annualForecast",
          "moq",
          "prototypeQty",
          "massProductionQty",
          "buyerSuppliedMaterials",
        ].map((key) => `project.${key}`),
        "chargeLines",
        ...[
          "toolingRequired",
          "toolingOwnership",
          "sampleApproval",
          "prototypeLeadTime",
          "massProductionLeadTime",
          "qualityStandard",
          "acceptance",
          "engineeringChange",
          "packaging",
          "delivery",
          "payment",
          "warranty",
          "intellectualProperty",
          "confidentiality",
          "materialReceiptAndReturn",
          "notes",
        ].map((key) => `terms.${key}`),
      ],
      expectedSelectOptions: {
        "meta.currency": ["CNY", "USD", "EUR"],
        "meta.taxMode": taxModeOptions,
        "meta.quoteNature": quoteNatureOptions,
        "seller.entityType": entityOptions,
        "buyer.entityType": entityOptions,
      },
      repeatablePaths: ["chargeLines"],
    },
    {
      id: "quotation.export.bilingual.v1",
      fixtureName: "quotation-export-bilingual",
      expectedPaths: [
        ...COMMON_META_PATHS,
        ...bilingualPartyPaths("seller"),
        ...bilingualPartyPaths("buyer"),
        "buyerReference",
        "goodsLines",
        "trade.incotermsRule",
        "trade.namedPlace",
        "trade.transportMode",
        "trade.originCountry",
        "trade.destinationCountry",
        "trade.portOfLoading",
        "trade.portOfDischarge",
        "trade.shipmentWindow",
        "trade.partialShipment",
        "trade.transshipment",
        "trade.exportPackaging",
        "trade.paymentMethod",
        "trade.bankCharges",
        "trade.insuranceArrangement",
        "trade.inspection",
        "trade.documentList",
        "trade.languagePriority",
        "trade.notes",
      ],
      expectedSelectOptions: {
        "meta.taxMode": taxModeOptions,
        "meta.quoteNature": quoteNatureOptions,
        "seller.entityType": entityOptions,
        "buyer.entityType": entityOptions,
        "trade.incotermsRule": incotermsOptions,
        "trade.transportMode": transportOptions,
        "trade.languagePriority": ["zh-CN", "en-US"],
      },
      repeatablePaths: ["goodsLines", "trade.documentList"],
    },
    {
      id: "quotation.proforma.invoice.v1",
      fixtureName: "quotation-proforma-invoice",
      expectedPaths: [
        ...COMMON_META_PATHS,
        ...partyPaths("seller"),
        ...partyPaths("buyer"),
        ...partyPaths("consignee"),
        ...partyPaths("notifyParty"),
        "buyerReference",
        "purchaseOrderReference",
        "goodsLines",
        ...["packageCount", "totalNetWeightKg", "totalGrossWeightKg", "totalVolumeCbm"].map(
          (key) => `shipment.${key}`,
        ),
        "shipment.incotermsRule",
        "shipment.namedPlace",
        "shipment.transportMode",
        "shipment.estimatedShippingDate",
        "shipment.paymentTerms",
        "shipment.originCountry",
        "shipment.destinationCountry",
        "shipment.portOfLoading",
        "shipment.portOfDischarge",
        "shipment.insuranceArrangement",
        "shipment.bankInstructions",
        "shipment.languagePriority",
        "charges.discountMinor",
        "charges.freightMinor",
        "charges.insuranceMinor",
        "charges.otherCharges",
      ],
      expectedSelectOptions: {
        "meta.taxMode": taxModeOptions,
        "meta.quoteNature": quoteNatureOptions,
        "seller.entityType": entityOptions,
        "buyer.entityType": entityOptions,
        "consignee.entityType": entityOptions,
        "notifyParty.entityType": entityOptions,
        "shipment.transportMode": transportOptions,
        "shipment.incotermsRule": incotermsOptions,
        "shipment.languagePriority": ["zh-CN", "en-US"],
      },
      repeatablePaths: ["goodsLines", "charges.otherCharges"],
    },
  ] as const;

  for (const fieldCase of cases) {
    it(`${fieldCase.id} publishes honest editable draft paths`, () => {
      verifyFieldManifest(fieldCase);
    });

    it(`${fieldCase.id} creates every repeatable item through the published parser gate`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(fieldCase.id, "1.0.0");
      const draft = registration.createDraft({
        id: `${fieldCase.id}-editor-draft`,
        now: "2026-08-20T00:00:00Z",
      });
      for (const [index, path] of fieldCase.repeatablePaths.entries()) {
        const id = `editor-item-${index}`;
        const item = registration.createRepeatableItem(path, {
          id,
          now: "2026-08-20T00:00:00Z",
          draft,
        });
        expect(Object.isFrozen(item)).toBe(true);
        const field = registration.definition.fieldManifest.find((entry) => entry.path === path);
        expect(field?.control).toBe("repeatable");
        if (
          field?.control === "repeatable" &&
          field.valueKind === "object-list" &&
          field.item.idPath
        ) {
          expect(draftPath(item, field.item.idPath)).toEqual({ exists: true, value: id });
        }
        const candidate = structuredClone(draft) as Record<string, unknown>;
        const items = draftPath(candidate, path).value;
        expect(Array.isArray(items)).toBe(true);
        (items as unknown[]).push(item);
        expect(() => registration.parseDraft(candidate)).not.toThrow();
      }
    });
  }
});
