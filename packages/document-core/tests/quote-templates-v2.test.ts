import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { STANDARD_GOODS_QUOTE_TEMPLATE } from "../src/index.js";
import { DocumentModelV2Schema, RiskFindingV2Schema } from "../src/v2/index.js";
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

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
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
