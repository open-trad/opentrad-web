import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentModelV2Schema,
  RiskFindingV2Schema,
  type TemplateFieldManifestEntryV1,
} from "../src/v2/index.js";
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

const INTERNATIONAL_SALE_SECTIONS = [
  "bilingual-cover",
  "meta",
  "bilingual-parties",
  "definitions",
  "goods",
  "price",
  "incoterms-delivery-risk",
  "shipment",
  "clearance-insurance",
  "documents",
  "inspection-claims",
  "title",
  "payment-bank",
  "packaging-marks",
  "warranty-ip",
  "compliance",
  "force-majeure-hardship",
  "breach-remedies",
  "cisg-governing-law",
  "dispute",
  "language-priority",
  "notices",
  "signatures",
] as const;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

function contractDraftPath(input: unknown, path: string): { exists: boolean; value: unknown } {
  let current = input;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function setContractDraftPath(input: Record<string, unknown>, path: string, value: unknown): void {
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

function editedContractFieldValue(field: TemplateFieldManifestEntryV1, current: unknown): unknown {
  switch (field.control) {
    case "text":
    case "textarea":
      expect(typeof current).toBe("string");
      return `${current as string}（已编辑）`;
    case "date":
      expect(typeof current).toBe("string");
      return "2026-09-17";
    case "checkbox":
      expect(typeof current).toBe("boolean");
      return !current;
    case "repeatable":
      expect(Array.isArray(current)).toBe(true);
      return editContractRepeatableField(current as unknown[]);
    case "select": {
      expect(typeof current).toBe("string");
      expect(field.options?.length).toBeGreaterThan(0);
      expect(field.options?.map((option) => option.value)).toContain(current);
      return field.options?.find((option) => option.value !== current)?.value ?? current;
    }
    case "attachment":
      throw new Error(`Attachment mutation requires a real second reference: ${field.path}`);
    case "datetime":
      expect(typeof current).toBe("string");
      return "2026-09-17T00:00:00.000Z";
    case "number":
    case "percent":
      expect(typeof current).toBe("number");
      return (current as number) + 1;
    case "money":
      expect(typeof current).toBe("string");
      return (BigInt(current as string) + 1n).toString();
  }
}

function editContractRepeatableField(current: unknown[]): unknown[] {
  const replacement = structuredClone(current);
  const first = replacement[0];
  expect(first).toBeDefined();
  expect(first).not.toBeNull();
  expect(typeof first).toBe("object");
  const record = first as Record<string, unknown>;
  for (const key of ["name", "title", "label", "description"]) {
    if (typeof record[key] === "string") {
      record[key] = `${record[key]}（已编辑）`;
      return replacement;
    }
  }
  throw new Error("Repeatable field has no safely editable descriptive value");
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
    expect(JSON.stringify(model)).toContain("上海示例制造有限公司");
    expect(JSON.stringify(model)).toContain("总经理");
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
    expect(serialized).toContain("tax-included");
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
    const created = registration.createDraft({
      id: "framework-created",
      now: "2026-08-19T00:00:00Z",
    }) as Record<string, unknown>;
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
    expect(() =>
      registration.parseDraft({ ...base, orderTemplateAttachmentId: "missing" }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, term: { ...term, endDate: "2026-08-01" } }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, catalogLines: [lines[0], lines[0]] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "seller" }],
      }),
    ).toThrow();
  });

  it("publishes honest unique field paths that remain editable through the exact parser", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("contract.supply.framework.v1", "1.0.0");
    const fields = registration.definition.fieldManifest;
    const paths = fields.map((field) => field.path);
    expect(fields.length).toBeGreaterThan(5);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).not.toEqual(
      expect.arrayContaining(["id", "templateId", "templateVersion", "updatedAt"]),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        "term.startDate",
        "term.endDate",
        "catalogLines",
        "pricing.currency",
        "pricing.taxMode",
        "forecast.binding",
        "ordering.documentPriority",
        "performance.supplyContinuity",
        "riskAcknowledgements.commercialRiskConfirmed",
        "orderTemplateAttachmentId",
      ]),
    );
    const expectedSelectOptions: Readonly<Record<string, readonly string[]>> = {
      "pricing.currency": ["CNY", "USD", "EUR"],
      "pricing.taxMode": ["tax-excluded", "tax-included", "tax-exempt"],
    };
    expect(
      fields
        .filter((field) => field.control === "select")
        .map((field) => field.path)
        .sort(),
    ).toEqual(Object.keys(expectedSelectOptions).sort());

    const base = registration.parseDraft(fixture("contract-framework-supply"));
    const sections = new Set(
      DocumentModelV2Schema.parse(registration.compile(base)).sections.map((section) => section.id),
    );
    for (const field of fields) {
      expect(sections.has(field.section)).toBe(true);
      const current = contractDraftPath(base, field.path);
      expect(current.exists, field.path).toBe(true);
      if (field.required) {
        expect(current.value).not.toBeUndefined();
        if (typeof current.value === "string")
          expect(current.value.trim().length).toBeGreaterThan(0);
        if (Array.isArray(current.value)) expect(current.value.length).toBeGreaterThan(0);
      }
      if (field.control !== "select") expect(field.options).toBeUndefined();
      if (field.control === "select") {
        expect(field.options?.map((option) => option.value)).toEqual(
          expectedSelectOptions[field.path],
        );
        for (const option of field.options ?? []) {
          const optionDraft = structuredClone(base) as Record<string, unknown>;
          setContractDraftPath(optionDraft, field.path, option.value);
          const optionParsed = registration.parseDraft(optionDraft);
          expect(contractDraftPath(optionParsed, field.path)).toEqual({
            exists: true,
            value: option.value,
          });
        }
      }
      if (field.visibleWhen) {
        const condition = contractDraftPath(base, field.visibleWhen.path);
        expect(condition.exists).toBe(true);
        expect(typeof condition.value).toBe(typeof field.visibleWhen.equals);
      }
      const edited = structuredClone(base) as Record<string, unknown>;
      let replacement: unknown;
      if (field.control === "attachment") {
        expect(typeof current.value).toBe("string");
        const attachments = edited.attachments as Array<Record<string, unknown>>;
        const source = attachments.find((attachment) => attachment.id === current.value);
        expect(source).toBeDefined();
        replacement = `${current.value as string}-alternate`;
        attachments.push({
          ...source,
          id: replacement,
          displayName: "采购订单备用模板.pdf",
        });
      } else {
        replacement = editedContractFieldValue(field, current.value);
      }
      expect(replacement).not.toEqual(current.value);
      setContractDraftPath(edited, field.path, replacement);
      const parsed = registration.parseDraft(edited);
      expect(contractDraftPath(parsed, field.path)).toEqual({ exists: true, value: replacement });
    }
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
    expect(JSON.stringify(model)).toContain("tax-included");
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
      materials: {
        ...materials,
        mode: "principal-supplied",
        yieldTarget: "",
        scrapHandling: "",
        returnMethod: "",
      },
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
    const products = base.products as Array<Record<string, unknown>>;
    expect(() =>
      registration.parseDraft({
        ...base,
        technical: { ...technical, drawingAttachmentIds: ["missing"] },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, tooling: [{ ...tooling[0], maintenance: "" }] }),
    ).toThrow();
    expect(() => registration.parseDraft({ ...base, tooling: [tooling[0], tooling[0]] })).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, products: [products[0], products[0]] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        production: { ...production, paymentSchedule: [{ ...schedule[0], amountBps: 9999 }] },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "supplier" }],
      }),
    ).toThrow();
    const created = registration.createDraft({
      id: "oem-contract-created",
      now: "2026-08-19T00:00:00Z",
    }) as Record<string, unknown>;
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
    expect(JSON.stringify(model)).toContain("tax-included");
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
    expect(
      registration
        .preflight({
          ...base,
          agency: { ...agency, thirdPartyAuthority: "仅可代为联系第三方" },
        })
        .map((finding) => [finding.code, finding.impact]),
    ).toEqual([["SERVICE_AGENCY_AUTHORITY_MISSING", "blockSubmission"]]);
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
    expect(() =>
      registration.parseDraft({ ...base, engagement: { ...engagement, endDate: "2026-08-01" } }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, fees: { ...fees, lines: [lines[0], lines[0]] } }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        fees: { ...fees, paymentSchedule: [{ ...schedule[0], amountBps: 9999 }] },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        rights: { ...rights, ipOwnership: "custom", ipCustomText: "" },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        signers: [{ ...(base.signers as Array<Record<string, unknown>>)[0], partyId: "customer" }],
      }),
    ).toThrow();
    const created = registration.createDraft({
      id: "service-contract-created",
      now: "2026-08-19T00:00:00Z",
    }) as Record<string, unknown>;
    expect((created.fees as Record<string, unknown>).currency).toBeUndefined();
    expect((created.fees as Record<string, unknown>).taxMode).toBeUndefined();
  });
});

describe("contract.sale.international-bilingual.v1", () => {
  it("pins international sources and compiles exact money into stable bilingual sections", () => {
    const registration = V2_TEMPLATE_REGISTRY.get(
      "contract.sale.international-bilingual.v1",
      "1.0.0",
    );
    const draft = registration.parseDraft(fixture("contract-international-sale"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
    expect(registration.definition).toMatchObject({
      id: "contract.sale.international-bilingual.v1",
      version: "1.0.0",
      category: "contract",
      basisDate: "2026-08-19",
      languages: ["zh-en"],
      defaultLanguage: "zh-en",
      allowedLayouts: ["international-compact.v1"],
      defaultLayout: "international-compact.v1",
      supportedOutputs: ["docx", "pdf", "json", "opentrad"],
      sourceKeys: ["uncitral-cisg", "icc-incoterms-2020"],
      disclaimerProfile: "international",
    });
    expect(model.sections.map((section) => section.id)).toEqual(INTERNATIONAL_SALE_SECTIONS);
    expect(model.language).toBe("zh-en");
    expect(model.disclaimers).toEqual(["international-choice-warning"]);
    expect(JSON.stringify(model)).toContain("USD 500.00");
    expect(JSON.stringify(model)).toContain("tax-exempt");
    expect(model.watermarks).toEqual([]);

    const pending: unknown[] = [model];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === null || typeof current !== "object") continue;
      const record = current as Record<PropertyKey, unknown>;
      if (typeof record.zhCN === "string") {
        expect(record.enUS, `missing English for ${record.zhCN}`).toEqual(expect.any(String));
        expect((record.enUS as string).trim()).not.toBe("");
      }
      for (const key of Reflect.ownKeys(record)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
        if (descriptor && "value" in descriptor) pending.push(descriptor.value);
      }
    }
  });

  it("blocks unresolved CISG, law, dispute and language priority with the draft watermark", () => {
    const registration = V2_TEMPLATE_REGISTRY.get(
      "contract.sale.international-bilingual.v1",
      "1.0.0",
    );
    const base = fixture("contract-international-sale") as Record<string, unknown>;
    const meta = base.meta as Record<string, unknown>;
    const legal = base.legal as Record<string, unknown>;
    const { languagePriority: _languagePriority, ...metaWithoutLanguagePriority } = meta;
    const risky = {
      ...base,
      meta: metaWithoutLanguagePriority,
      legal: {
        ...legal,
        cisgChoice: "undecided",
        governingLaw: undefined,
        disputeMethod: undefined,
        forum: undefined,
      },
    };
    expect(registration.preflight(risky).map((finding) => [finding.code, finding.impact])).toEqual([
      ["INTERNATIONAL_CISG_UNDECIDED", "blockSubmission"],
      ["INTERNATIONAL_GOVERNING_LAW_UNDECIDED", "blockSubmission"],
      ["INTERNATIONAL_DISPUTE_METHOD_UNDECIDED", "blockSubmission"],
      ["INTERNATIONAL_DISPUTE_FORUM_UNDECIDED", "blockSubmission"],
      ["INTERNATIONAL_LANGUAGE_PRIORITY_UNDECIDED", "blockSubmission"],
      ["HS_CODE_USER_SUPPLIED_UNVERIFIED", "advisory"],
    ]);
    const model = DocumentModelV2Schema.parse(registration.compile(risky));
    expect(model.watermarks).toEqual([
      {
        id: "review-required",
        text: { zhCN: "国际销售合同草案", enUS: "DRAFT INTERNATIONAL SALE CONTRACT" },
        scope: "every-page",
      },
    ]);
  });

  it("requires authored English for parties, items, signers and every supplied clause", () => {
    const registration = V2_TEMPLATE_REGISTRY.get(
      "contract.sale.international-bilingual.v1",
      "1.0.0",
    );
    const base = fixture("contract-international-sale") as Record<string, unknown>;
    const seller = base.seller as Record<string, unknown>;
    const line = (base.goodsLines as Array<Record<string, unknown>>)[0];
    const performance = base.performance as Record<string, unknown>;
    const warranty = performance.warranty as Record<string, unknown>;
    const signer = (base.signers as Array<Record<string, unknown>>)[0];
    expect(() =>
      registration.parseDraft({ ...base, seller: { ...seller, englishName: undefined } }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, goodsLines: [{ ...line, englishName: undefined }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        performance: { ...performance, warranty: { zhCN: warranty.zhCN } },
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, signers: [{ ...signer, role: { zhCN: "卖方" } }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, goodsLines: [{ ...line, netWeightKg: "0" }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        goodsLines: [{ ...line, hsCodeUserSupplied: "1234567890123" }],
      }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, goodsLines: [{ ...line, specification: "国标泵" }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({ ...base, goodsLines: [{ ...line, unit: "台" }] }),
    ).toThrow();
    expect(() =>
      registration.parseDraft({
        ...base,
        legal: { ...(base.legal as object), languagePriority: "en-US" },
      }),
    ).toThrow();
    expect(() => registration.parseDraft({ ...base, goodsLines: [line, line] })).toThrow();
  });

  it("does not choose trade or legal terms and reparses every public operation", () => {
    const registration = V2_TEMPLATE_REGISTRY.get(
      "contract.sale.international-bilingual.v1",
      "1.0.0",
    );
    const created = registration.createDraft({
      id: "international-created",
      now: "2026-08-19T00:00:00Z",
    }) as Record<string, unknown>;
    const price = created.price as Record<string, unknown>;
    const trade = created.trade as Record<string, unknown>;
    const legal = created.legal as Record<string, unknown>;
    const meta = created.meta as Record<string, unknown>;
    expect(price.currency).toBeUndefined();
    expect(price.taxMode).toBeUndefined();
    expect(trade.incotermsRule).toBeUndefined();
    expect(trade.transportMode).toBeUndefined();
    expect(trade.exportClearanceParty).toBeUndefined();
    expect(trade.importClearanceParty).toBeUndefined();
    expect(legal).toMatchObject({ cisgChoice: "undecided" });
    expect(legal.governingLaw).toBeUndefined();
    expect(legal.disputeMethod).toBeUndefined();
    expect(meta.languagePriority).toBeUndefined();
    expect(registration.preflight(created).map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "CONTRACT_CURRENCY_MISSING",
        "CONTRACT_TAX_MODE_MISSING",
        "INCOTERMS_SELECTION_MISSING",
        "INTERNATIONAL_TRANSPORT_MISSING",
        "INTERNATIONAL_EXPORT_CLEARANCE_UNDECIDED",
        "INTERNATIONAL_IMPORT_CLEARANCE_UNDECIDED",
        "INTERNATIONAL_INSURANCE_MISSING",
        "INTERNATIONAL_CISG_UNDECIDED",
        "INTERNATIONAL_GOVERNING_LAW_UNDECIDED",
        "INTERNATIONAL_DISPUTE_METHOD_UNDECIDED",
        "INTERNATIONAL_LANGUAGE_PRIORITY_UNDECIDED",
      ]),
    );
    expect(JSON.stringify(created)).not.toMatch(
      /derivedTax|verifiedHs|cisgApplicable|automaticLaw/,
    );
    expect(() => registration.compile({ ...created, unknown: true })).toThrow();
    expect(() => registration.preflight({ ...created, unknown: true })).toThrow();
  });

  it("publishes only the included portable attachment subset for all attachment contracts", () => {
    const cases = [
      ["contract.sale.domestic-b2b.v1", "contract-domestic-sale"],
      ["contract.supply.framework.v1", "contract-framework-supply"],
      ["contract.oem.processing.v1", "contract-oem-processing"],
    ] as const;

    for (const [templateId, fixtureName] of cases) {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const base = fixture(fixtureName) as Record<string, unknown>;
      const [original] = base.attachments as Array<Record<string, unknown>>;
      if (!original || typeof original.id !== "string")
        throw new Error("Missing attachment fixture");
      const storageKey = `${templateId}@1.0.0:${base.id as string}`;
      const draft = registration.parseDraft({
        ...base,
        ...(templateId === "contract.supply.framework.v1"
          ? { orderTemplateAttachmentId: "included-safe" }
          : {}),
        ...(templateId === "contract.oem.processing.v1"
          ? {
              technical: {
                ...(base.technical as Record<string, unknown>),
                drawingAttachmentIds: ["included-safe"],
              },
            }
          : {}),
        attachments: [
          {
            ...original,
            required: false,
            sourceRef: "file:///Users/example/private-source.pdf",
            localBlobKey: `${storageKey}#${original.id}`,
            includedInSubmission: false,
          },
          {
            ...original,
            id: "included-safe",
            displayName: "用户确认的附件证据.pdf",
            sourceRef: "用户确认的附件证据编号 C-1",
            localBlobKey: `${storageKey}#included-safe`,
          },
          {
            ...original,
            id: "included-uri",
            displayName: "随附技术资料.pdf",
            sourceRef: "https://example.invalid/private-source.pdf",
            localBlobKey: `${storageKey}#included-uri`,
          },
          {
            ...original,
            id: "included-relative",
            displayName: "相对目录技术资料.pdf",
            sourceRef: "private/contracts/source.pdf",
            localBlobKey: `${storageKey}#included-relative`,
          },
          {
            ...original,
            id: "included-users-path",
            displayName: "用户目录技术资料.pdf",
            sourceRef: "Users/example/private.pdf",
            localBlobKey: `${storageKey}#included-users-path`,
          },
        ],
      });

      const model = DocumentModelV2Schema.parse(registration.compile(draft));
      expect(model.attachmentManifest.map((attachment) => attachment.id)).toEqual([
        "included-safe",
        "included-uri",
        "included-relative",
        "included-users-path",
      ]);
      expect(model.attachmentManifest[0]?.sourceRef).toBe("用户确认的附件证据编号 C-1");
      expect(model.attachmentManifest[1]).not.toHaveProperty("sourceRef");
      expect(model.attachmentManifest[2]).not.toHaveProperty("sourceRef");
      expect(model.attachmentManifest[3]).not.toHaveProperty("sourceRef");
      expect(model.attachmentManifest.every((attachment) => !("localBlobKey" in attachment))).toBe(
        true,
      );
      const indexedIds = model.sections.flatMap((section) =>
        section.blocks.flatMap((block) =>
          block.type === "attachmentIndex" ? block.attachmentIds : [],
        ),
      );
      expect(indexedIds).not.toContain(original.id);
      if (templateId === "contract.supply.framework.v1") {
        expect(
          model.sections
            .flatMap((section) => section.blocks)
            .find((block) => block.id === "order-template-index"),
        ).toMatchObject({ attachmentIds: ["included-safe"] });
      }
      if (templateId === "contract.oem.processing.v1") {
        expect(
          model.sections
            .flatMap((section) => section.blocks)
            .find((block) => block.id === "drawing-index"),
        ).toMatchObject({ attachmentIds: ["included-safe"] });
      }
    }
  });

  it("keeps four quotations and five contracts in the final fourteen-template registry", () => {
    const registrations = V2_TEMPLATE_REGISTRY.list();
    expect(registrations).toHaveLength(14);
    expect(registrations.filter((item) => item.definition.category === "quotation")).toHaveLength(
      4,
    );
    expect(registrations.filter((item) => item.definition.category === "contract")).toHaveLength(5);
    expect(registrations.filter((item) => item.definition.category === "bid")).toHaveLength(5);
    const registration = V2_TEMPLATE_REGISTRY.get(
      "contract.sale.international-bilingual.v1",
      "1.0.0",
    );
    const model = DocumentModelV2Schema.parse(
      registration.compile(fixture("contract-international-sale")),
    );
    const serialized = JSON.stringify(model);
    expect(serialized).not.toMatch(/bigint|blob:|data:|localBlobKey/);
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.definition)).toBe(true);
  });
});

describe("five contract schema security and budget matrix", () => {
  const cases = [
    {
      id: "contract.sale.domestic-b2b.v1",
      fixtureName: "contract-domestic-sale",
      partyKey: "seller",
      getLines: (base: Record<string, unknown>) =>
        base.goodsLines as Array<Record<string, unknown>>,
      withLines: (base: Record<string, unknown>, lines: unknown[]) => ({
        ...base,
        goodsLines: lines,
      }),
      overBudget: (base: Record<string, unknown>) => ({
        ...base,
        acceptance: { ...(base.acceptance as object), warranty: "保".repeat(10_001) },
      }),
    },
    {
      id: "contract.supply.framework.v1",
      fixtureName: "contract-framework-supply",
      partyKey: "supplier",
      getLines: (base: Record<string, unknown>) =>
        base.catalogLines as Array<Record<string, unknown>>,
      withLines: (base: Record<string, unknown>, lines: unknown[]) => ({
        ...base,
        catalogLines: lines,
      }),
      overBudget: (base: Record<string, unknown>) => ({
        ...base,
        ordering: { ...(base.ordering as object), formation: "项".repeat(10_001) },
      }),
    },
    {
      id: "contract.oem.processing.v1",
      fixtureName: "contract-oem-processing",
      partyKey: "principal",
      getLines: (base: Record<string, unknown>) => base.products as Array<Record<string, unknown>>,
      withLines: (base: Record<string, unknown>, lines: unknown[]) => ({
        ...base,
        products: lines,
      }),
      overBudget: (base: Record<string, unknown>) => ({
        ...base,
        technical: { ...(base.technical as object), packageVersion: "版".repeat(10_001) },
      }),
    },
    {
      id: "contract.service.commercial.v1",
      fixtureName: "contract-commercial-service",
      partyKey: "client",
      getLines: (base: Record<string, unknown>) =>
        (base.fees as Record<string, unknown>).lines as Array<Record<string, unknown>>,
      withLines: (base: Record<string, unknown>, lines: unknown[]) => ({
        ...base,
        fees: { ...(base.fees as object), lines },
      }),
      overBudget: (base: Record<string, unknown>) => ({
        ...base,
        engagement: { ...(base.engagement as object), scope: "域".repeat(10_001) },
      }),
    },
    {
      id: "contract.sale.international-bilingual.v1",
      fixtureName: "contract-international-sale",
      partyKey: "seller",
      getLines: (base: Record<string, unknown>) =>
        base.goodsLines as Array<Record<string, unknown>>,
      withLines: (base: Record<string, unknown>, lines: unknown[]) => ({
        ...base,
        goodsLines: lines,
      }),
      overBudget: (base: Record<string, unknown>) => ({
        ...base,
        performance: {
          ...(base.performance as object),
          warranty: { zhCN: "保".repeat(10_001), enUS: "Warranty" },
        },
      }),
    },
  ] as const;

  for (const contractCase of cases) {
    it(`${contractCase.id} fails closed and enforces the 100-row bound`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(contractCase.id, "1.0.0");
      const base = fixture(contractCase.fixtureName) as Record<string, unknown>;
      expect(() => registration.parseDraft({ ...base, unknown: true })).toThrow();
      expect(() => registration.compile({ ...base, unknown: true })).toThrow();
      expect(() => registration.preflight({ ...base, unknown: true })).toThrow();

      const getter = vi.fn(() => base.meta);
      const accessor = { ...base };
      Object.defineProperty(accessor, "meta", { enumerable: true, get: getter });
      expect(() => registration.parseDraft(accessor)).toThrow();
      expect(getter).not.toHaveBeenCalled();
      const party = base[contractCase.partyKey] as Record<string, unknown>;
      expect(() =>
        registration.parseDraft({
          ...base,
          [contractCase.partyKey]: { ...party, rolePrompt: "hidden" },
        }),
      ).toThrow();
      const partyGetter = vi.fn(() => "secret");
      const accessorParty = { ...party };
      Object.defineProperty(accessorParty, "legalName", {
        enumerable: true,
        get: partyGetter,
      });
      expect(() =>
        registration.parseDraft({ ...base, [contractCase.partyKey]: accessorParty }),
      ).toThrow();
      expect(partyGetter).not.toHaveBeenCalled();
      expect(() =>
        registration.parseDraft({
          ...base,
          [contractCase.partyKey]: Object.assign(Object.create({ inherited: true }), party),
        }),
      ).toThrow();
      expect(() => contractCase.withLines(base, new Array(1))).toBeDefined();
      expect(() => registration.parseDraft(contractCase.withLines(base, new Array(1)))).toThrow();
      expect(() =>
        registration.parseDraft(Object.assign(Object.create({ inherited: true }), base)),
      ).toThrow();
      const { proxy, revoke } = Proxy.revocable(base, {});
      revoke();
      expect(() => registration.parseDraft(proxy)).toThrow();
      expect(() => registration.parseDraft(contractCase.overBudget(base))).toThrow();

      const exemplar = contractCase.getLines(base)[0];
      const lines100 = Array.from({ length: 100 }, (_, index) => ({
        ...exemplar,
        id: `line-${index}`,
      }));
      expect(() => registration.parseDraft(contractCase.withLines(base, lines100))).not.toThrow();
      const lines101 = [...lines100, { ...exemplar, id: "line-100" }];
      expect(() => registration.parseDraft(contractCase.withLines(base, lines101))).toThrow();
    });
  }
});
