import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DocumentModelV2Schema, RiskFindingV2Schema } from "../src/v2/index.js";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index.js";

const DOMESTIC_SECTIONS = [
  "cover",
  "meta",
  "parties",
  "subject-goods",
  "price-tax-invoice",
  "payment",
  "delivery-packaging",
  "title-risk",
  "inspection-acceptance",
  "quality-warranty",
  "parties-obligations",
  "breach-termination",
  "force-majeure",
  "notices",
  "governing-law-dispute",
  "miscellaneous",
  "attachments",
  "signatures",
] as const;

const FRAMEWORK_SECTIONS = [
  "cover",
  "meta",
  "parties",
  "framework-purpose",
  "term",
  "catalog-price",
  "forecast",
  "minimum-or-exclusivity",
  "orders-priority",
  "capacity-inventory",
  "delivery-acceptance",
  "reconciliation-payment",
  "quality-warranty",
  "continuity",
  "change-termination-transition",
  "general-terms",
  "order-template",
  "signatures",
] as const;

const OEM_PROCESSING_SECTIONS = [
  "cover",
  "meta",
  "parties",
  "commissioned-products",
  "technical-documents",
  "sample-approval",
  "materials",
  "tooling",
  "production-schedule",
  "fees-payment",
  "quality-inspection",
  "nonconformance-recall",
  "engineering-change",
  "ip-license",
  "confidentiality-subcontracting",
  "termination-compensation",
  "general-terms",
  "attachments",
  "signatures",
] as const;

const COMMERCIAL_SERVICE_SECTIONS = [
  "cover",
  "meta",
  "parties",
  "service-matter",
  "work-requirements",
  "term-location",
  "deliverables-reporting",
  "client-dependencies",
  "subcontract-parallel-engagement",
  "fees-expenses-payment",
  "acceptance",
  "ip-data-confidentiality",
  "agency-third-party",
  "rights-obligations",
  "breach",
  "termination-at-will",
  "general-terms",
  "signatures",
] as const;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

describe("contract.sale.domestic-b2b.v1", () => {
  it("registers the exact definition and compiles exact money into stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.sale.domestic-b2b.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("contract-domestic-sale"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));

    expect(registration.definition).toMatchObject({
      id: "contract.sale.domestic-b2b.v1",
      version: "1.0.0",
      category: "contract",
      basisDate: "2026-08-19",
      languages: ["zh-CN"],
      defaultLanguage: "zh-CN",
      allowedLayouts: ["classic-formal.v1"],
      defaultLayout: "classic-formal.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
      sourceKeys: ["prc-civil-code", "samr-contract-library"],
      disclaimerProfile: "contract",
    });
    expect(model.sections.map((section) => section.id)).toEqual(DOMESTIC_SECTIONS);
    expect(model.disclaimers).toEqual(["contract-generation-note"]);
    expect(JSON.stringify(model)).toContain("CNY 200.00");
    const titleRisk = model.sections.find((section) => section.id === "title-risk");
    expect(titleRisk?.blocks).toHaveLength(2);
    expect(JSON.stringify(titleRisk)).toContain("所有权转移");
    expect(JSON.stringify(titleRisk)).toContain("风险转移");
    expect(JSON.stringify(model)).toContain("留存比例属于付款进度分配，不从合同总价重复扣减");
    expect(JSON.stringify(model)).not.toMatch(/官方示范|已审核合规|自动适用税率/);
    expect(Object.isFrozen(model)).toBe(true);
  });

  it("reparses every public operation and blocks missing business choices without rejecting drafts", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.sale.domestic-b2b.v1", "1.0.0");
    const created = registration.createDraft({
      id: "domestic-created",
      now: "2028-02-29T23:30:00.000-08:00",
    }) as Record<string, unknown>;
    const price = created.price as Record<string, unknown>;
    expect((created.meta as Record<string, unknown>).signingDate).toBe("2028-03-01");
    expect(price.currency).toBeUndefined();
    expect(price.taxMode).toBeUndefined();
    expect(price.invoiceType).toBeUndefined();
    const findings = registration.preflight(created);
    expect(findings.map((finding) => [finding.code, finding.impact])).toEqual(
      expect.arrayContaining([
        ["CONTRACT_CURRENCY_MISSING", "blockSubmission"],
        ["CONTRACT_TAX_MODE_MISSING", "blockSubmission"],
        ["DOMESTIC_INVOICE_TYPE_MISSING", "blockSubmission"],
        ["DOMESTIC_INVOICE_TIMING_MISSING", "blockSubmission"],
        ["DOMESTIC_RISK_TRANSFER_MISSING", "blockSubmission"],
        ["DOMESTIC_INSPECTION_PERIOD_MISSING", "blockSubmission"],
        ["DOMESTIC_OBJECTION_METHOD_MISSING", "blockSubmission"],
      ]),
    );
    expect(findings.map((finding) => RiskFindingV2Schema.parse(finding))).toEqual(findings);
    expect(DocumentModelV2Schema.parse(registration.compile(created)).watermarks).toHaveLength(1);
    expect(() => registration.compile({ ...created, unknown: true })).toThrow();
    expect(() => registration.preflight({ ...created, unknown: true })).toThrow();
  });

  it("validates signer and attachment references, unique ids and exact payment schedule", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.sale.domestic-b2b.v1", "1.0.0");
    const base = fixture("contract-domestic-sale") as Record<string, unknown>;
    const signers = base.signers as Array<Record<string, unknown>>;
    const attachments = base.attachments as Array<Record<string, unknown>>;
    const price = base.price as Record<string, unknown>;
    const schedule = price.paymentSchedule as Array<Record<string, unknown>>;
    expect(() =>
      registration.parseDraft({ ...base, signers: [{ ...signers[0], partyId: "supplier" }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, attachments: [attachments[0], attachments[0]] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        price: {
          ...price,
          paymentSchedule: [{ ...schedule[0], amountBps: 9999 }],
        },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        goodsLines: [
          ...(base.goodsLines as unknown[]),
          { ...(base.goodsLines as Array<Record<string, unknown>>)[0] },
        ],
      }),
    ).toThrow();
  });

  it("fails closed for unknown, accessors, sparse arrays, prototypes, revoked proxies and budgets", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.sale.domestic-b2b.v1", "1.0.0");
    const base = fixture("contract-domestic-sale") as Record<string, unknown>;
    expect(() => registration.parseDraft({ ...base, unknown: true })).toThrow();
    const getter = vi.fn(() => "不应执行");
    const accessor = { ...base };
    Object.defineProperty(accessor, "price", { enumerable: true, get: getter });
    expect(() => registration.parseDraft(accessor)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => registration.parseDraft({ ...base, goodsLines: new Array(1) })).toThrow();
    expect(() =>
      registration.parseDraft(Object.assign(Object.create({ inherited: true }), base)),
    ).toThrow();
    const { proxy, revoke } = Proxy.revocable(base, {});
    revoke();
    expect(() => registration.parseDraft(proxy)).toThrow();
    const acceptance = base.acceptance as Record<string, unknown>;
    expect(() =>
      registration.parseDraft({
        ...base,
        acceptance: { ...acceptance, warranty: "保".repeat(20_001) },
      }),
    ).toThrow();
  });
});

describe("contract.supply.framework.v1", () => {
  it("pins sources, renders the nonbinding forecast rule and compiles stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.supply.framework.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("contract-framework-supply"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "contract.supply.framework.v1",
      version: "1.0.0",
      category: "contract",
      basisDate: "2026-08-19",
      languages: ["zh-CN"],
      allowedLayouts: ["classic-formal.v1"],
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
      sourceKeys: ["prc-civil-code", "samr-contract-library"],
      disclaimerProfile: "contract",
    });
    expect(model.sections.map((section) => section.id)).toEqual(FRAMEWORK_SECTIONS);
    const serialized = JSON.stringify(model);
    expect(serialized).toContain("预测和目录不当然构成采购义务");
    expect(serialized).toContain("CNY 500.00");
    expect(serialized).toContain("供应中断风险");
    expect(serialized).not.toContain("commercialRiskConfirmed");
    expect(model.disclaimers).toEqual(["contract-generation-note"]);
  });

  it("keeps commercial confirmation in preflight only and reparses public operations", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.supply.framework.v1", "1.0.0");
    const base = fixture("contract-framework-supply") as Record<string, unknown>;
    const riskAcknowledgements = base.riskAcknowledgements as Record<string, unknown>;
    const risky = {
      ...base,
      riskAcknowledgements: { ...riskAcknowledgements, commercialRiskConfirmed: false },
    };
    expect(registration.preflight(risky).map((finding) => [finding.code, finding.impact])).toEqual([
      ["FRAMEWORK_COMMERCIAL_RISK_UNCONFIRMED", "watermark"],
    ]);
    expect(DocumentModelV2Schema.parse(registration.compile(risky)).watermarks).toHaveLength(1);
    expect(registration.preflight(base)).toEqual([]);
    const created = registration.createDraft({ id: "framework-created", now: "2026-08-19T00:00:00Z" }) as Record<string, unknown>;
    const pricing = created.pricing as Record<string, unknown>;
    expect(pricing.currency).toBeUndefined();
    expect(pricing.taxMode).toBeUndefined();
    expect(registration.preflight(created).map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["CONTRACT_CURRENCY_MISSING", "CONTRACT_TAX_MODE_MISSING"]),
    );
    expect(() => registration.compile({ ...created, unknown: true })).toThrow();
    expect(() => registration.preflight({ ...created, unknown: true })).toThrow();
  });

  it("cross-validates the order template, signer roles, dates and catalog ids", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.supply.framework.v1", "1.0.0");
    const base = fixture("contract-framework-supply") as Record<string, unknown>;
    const term = base.term as Record<string, unknown>;
    const lines = base.catalogLines as Array<Record<string, unknown>>;
    expect(() => registration.parseDraft({ ...base, orderTemplateAttachmentId: "missing" })).toThrow();
    expect(() => registration.parseDraft({ ...base, term: { ...term, endDate: "2026-08-01" } })).toThrow();
    expect(() => registration.parseDraft({ ...base, catalogLines: [lines[0], lines[0]] })).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "seller" }],
      }),
    ).toThrow();
  });
});

describe("contract.oem.processing.v1", () => {
  it("pins sources, projects exact processing-fee calculation and compiles stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.oem.processing.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("contract-oem-processing"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "contract.oem.processing.v1",
      version: "1.0.0",
      category: "contract",
      basisDate: "2026-08-19",
      languages: ["zh-CN"],
      allowedLayouts: ["classic-formal.v1"],
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
      sourceKeys: ["prc-civil-code", "samr-entrustment-2025"],
      disclaimerProfile: "contract",
    });
    expect(model.sections.map((section) => section.id)).toEqual(OEM_PROCESSING_SECTIONS);
    expect(JSON.stringify(model)).toContain("CNY 500.00");
    expect(JSON.stringify(model)).toContain("TECH-S1-R3");
    expect(model.disclaimers).toEqual(["contract-generation-note"]);
  });

  it("enforces supplied-material, IP, subcontracting, change and termination conditions in shared analysis", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.oem.processing.v1", "1.0.0");
    const base = fixture("contract-oem-processing") as Record<string, unknown>;
    const technical = base.technical as Record<string, unknown>;
    const materials = base.materials as Record<string, unknown>;
    const intellectualProperty = base.intellectualProperty as Record<string, unknown>;
    const risky = {
      ...base,
      technical: { ...technical, engineeringChange: "" },
      materials: { ...materials, mode: "principal-supplied", yieldTarget: "", scrapHandling: "", returnMethod: "" },
      intellectualProperty: { ...intellectualProperty, backgroundIp: "", foregroundIp: "" },
      subcontracting: "",
      terminationCompensation: "",
    };
    expect(registration.preflight(risky).map((finding) => [finding.code, finding.impact])).toEqual([
      ["OEM_MATERIAL_YIELD_MISSING", "blockSubmission"],
      ["OEM_MATERIAL_SCRAP_MISSING", "blockSubmission"],
      ["OEM_MATERIAL_RETURN_MISSING", "blockSubmission"],
      ["OEM_BACKGROUND_IP_MISSING", "blockSubmission"],
      ["OEM_FOREGROUND_IP_MISSING", "blockSubmission"],
      ["OEM_SUBCONTRACTING_MISSING", "blockSubmission"],
      ["OEM_ENGINEERING_CHANGE_MISSING", "blockSubmission"],
      ["OEM_TERMINATION_COMPENSATION_MISSING", "blockSubmission"],
    ]);
    expect(DocumentModelV2Schema.parse(registration.compile(risky)).watermarks).toHaveLength(1);
    expect(() => registration.preflight({ ...base, unknown: true })).toThrow();
    expect(() => registration.compile({ ...base, unknown: true })).toThrow();
  });

  it("cross-validates drawings and signer roles and requires exact payment and complete tooling rows", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.oem.processing.v1", "1.0.0");
    const base = fixture("contract-oem-processing") as Record<string, unknown>;
    const technical = base.technical as Record<string, unknown>;
    const production = base.production as Record<string, unknown>;
    const schedule = production.paymentSchedule as Array<Record<string, unknown>>;
    const tooling = base.tooling as Array<Record<string, unknown>>;
    expect(() => registration.parseDraft({ ...base, technical: { ...technical, drawingAttachmentIds: ["missing"] } })).toThrow();
    expect(() => registration.parseDraft({ ...base, tooling: [{ ...tooling[0], maintenance: "" }] })).toThrow();
    expect(() => registration.parseDraft({ ...base, production: { ...production, paymentSchedule: [{ ...schedule[0], amountBps: 9999 }] } })).toThrow();
    expect(() => registration.parseDraft({ ...base, signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "supplier" }] })).toThrow();
    const created = registration.createDraft({ id: "oem-contract-created", now: "2026-08-19T00:00:00Z" }) as Record<string, unknown>;
    expect((created.production as Record<string, unknown>).currency).toBeUndefined();
    expect((created.production as Record<string, unknown>).taxMode).toBeUndefined();
  });
});

describe("contract.service.commercial.v1", () => {
  it("pins sources, projects ServiceLineV2 money and compiles Chinese-only stable sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.service.commercial.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("contract-commercial-service"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "contract.service.commercial.v1",
      version: "1.0.0",
      category: "contract",
      basisDate: "2026-08-19",
      languages: ["zh-CN"],
      allowedLayouts: ["modern-business.v1", "classic-formal.v1"],
      defaultLayout: "modern-business.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
      sourceKeys: ["samr-entrustment-2025", "prc-civil-code"],
      disclaimerProfile: "contract",
    });
    expect(model.sections.map((section) => section.id)).toEqual(COMMERCIAL_SERVICE_SECTIONS);
    expect(JSON.stringify(model)).toContain("CNY 1,000.00");
    expect(JSON.stringify(model)).not.toContain('"enUS"');
    expect(model.disclaimers).toEqual(["contract-generation-note"]);
  });

  it("blocks incomplete personal-data, agency and termination-at-will terms via shared analysis", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.service.commercial.v1", "1.0.0");
    const base = fixture("contract-commercial-service") as Record<string, unknown>;
    const rights = base.rights as Record<string, unknown>;
    const agency = base.agency as Record<string, unknown>;
    const terminationAtWill = base.terminationAtWill as Record<string, unknown>;
    const risky = {
      ...base,
      rights: { ...rights, personalDataTerms: "仅说明处理目的" },
      agency: { ...agency, thirdPartyAuthority: "" },
      terminationAtWill: { ...terminationAtWill, handling: "", compensation: "" },
    };
    expect(registration.preflight(risky).map((finding) => [finding.code, finding.impact])).toEqual([
      ["SERVICE_PERSONAL_DATA_TERMS_INCOMPLETE", "blockSubmission"],
      ["SERVICE_AGENCY_AUTHORITY_MISSING", "blockSubmission"],
      ["SERVICE_TERMINATION_HANDLING_MISSING", "blockSubmission"],
      ["SERVICE_TERMINATION_COMPENSATION_MISSING", "blockSubmission"],
    ]);
    expect(DocumentModelV2Schema.parse(registration.compile(risky)).watermarks).toHaveLength(1);
    expect(() => registration.preflight({ ...base, unknown: true })).toThrow();
    expect(() => registration.compile({ ...base, unknown: true })).toThrow();
  });

  it("validates service ids, dates, custom IP, payment proportions and signer roles", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.service.commercial.v1", "1.0.0");
    const base = fixture("contract-commercial-service") as Record<string, unknown>;
    const engagement = base.engagement as Record<string, unknown>;
    const fees = base.fees as Record<string, unknown>;
    const lines = fees.lines as Array<Record<string, unknown>>;
    const schedule = fees.paymentSchedule as Array<Record<string, unknown>>;
    const rights = base.rights as Record<string, unknown>;
    expect(() => registration.parseDraft({ ...base, engagement: { ...engagement, endDate: "2026-08-01" } })).toThrow();
    expect(() => registration.parseDraft({ ...base, fees: { ...fees, lines: [lines[0], lines[0]] } })).toThrow();
    expect(() => registration.parseDraft({ ...base, fees: { ...fees, paymentSchedule: [{ ...schedule[0], amountBps: 9999 }] } })).toThrow();
    expect(() => registration.parseDraft({ ...base, rights: { ...rights, ipOwnership: "custom", ipCustomText: "" } })).toThrow();
    expect(() => registration.parseDraft({ ...base, signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "customer" }] })).toThrow();
    const created = registration.createDraft({ id: "service-contract-created", now: "2026-08-19T00:00:00Z" }) as Record<string, unknown>;
    expect((created.fees as Record<string, unknown>).currency).toBeUndefined();
    expect((created.fees as Record<string, unknown>).taxMode).toBeUndefined();
  });
});
