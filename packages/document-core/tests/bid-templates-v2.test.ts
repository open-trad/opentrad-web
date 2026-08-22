import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TemplateFieldManifestEntryV1 } from "../src/v2/common.js";
import { DocumentModelV2Schema, RiskFindingV2Schema } from "../src/v2/index.js";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index.js";

const GOVERNMENT_GOODS_SECTIONS = [
  "draft-cover",
  "source-baseline",
  "toc",
  "bid-letter",
  "legal-representative",
  "authorization",
  "qualification-index",
  "qualifications",
  "policy-declarations",
  "opening-price",
  "itemized-price",
  "technical-response",
  "business-response",
  "delivery-installation",
  "training-acceptance",
  "warranty-aftersales",
  "deviations",
  "attachments",
  "final-checklist",
  "signatures",
] as const;

const GOVERNMENT_SERVICES_SECTIONS = [
  "draft-cover",
  "source-baseline",
  "toc",
  "bid-letter",
  "authorization",
  "qualifications",
  "policy-declarations",
  "opening-price",
  "service-price",
  "requirement-response",
  "understanding-objectives",
  "methodology",
  "deliverables-schedule",
  "staffing",
  "quality-sla",
  "risk-security-privacy",
  "acceptance",
  "performance-evidence",
  "deviations",
  "attachments",
  "final-checklist",
  "signatures",
] as const;

const CONSTRUCTION_WORKS_SECTIONS = [
  "internal-cover",
  "source-baseline",
  "toc",
  "bid-letter-and-appendix",
  "authorization",
  "qualifications",
  "guarantee",
  "priced-boq",
  "commercial-deviations",
  "technical-deviations",
  "construction-organization",
  "schedule",
  "site-resources",
  "project-manager",
  "key-personnel",
  "equipment",
  "quality",
  "safety-environment",
  "subcontract",
  "experience",
  "attachments",
  "final-checklist",
  "signatures",
] as const;

const ENTERPRISE_GOODS_SECTIONS = [
  "draft-cover",
  "source-baseline",
  "toc",
  "offer-letter",
  "bidder-profile",
  "qualifications",
  "executive-summary",
  "price",
  "goods-offer",
  "requirements-matrix",
  "technical-solution",
  "delivery",
  "quality-acceptance",
  "warranty-aftersales",
  "continuity",
  "commercial-terms",
  "deviations",
  "cases",
  "attachments",
  "checklist",
  "signatures",
] as const;

const ENTERPRISE_SERVICES_SECTIONS = [
  "draft-cover",
  "source-baseline",
  "toc",
  "proposal-letter",
  "executive-summary",
  "customer-understanding",
  "scope",
  "methodology",
  "deliverables",
  "schedule",
  "team-governance",
  "sla-quality",
  "security-privacy",
  "assumptions-dependencies-exclusions",
  "commercial-offer",
  "cases",
  "risks",
  "deviations",
  "attachments",
  "checklist",
  "signatures",
] as const;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type MutableRecord = Record<string, unknown>;

function mutableRecord(value: unknown, label: string): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object at ${label}`);
  }
  return value as MutableRecord;
}

function readDraftPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (current === undefined) return undefined;
    current = mutableRecord(current, path)[part];
  }
  return current;
}

function writeDraftPath(root: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = mutableRecord(root, path);
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === undefined) current[part] = {};
    current = mutableRecord(current[part], path);
  }
  const leaf = parts.at(-1);
  if (!leaf) throw new Error("Editor path cannot be empty");
  current[leaf] = value;
}

function draftList(root: unknown, path: string): unknown[] {
  const value = readDraftPath(root, path);
  if (!Array.isArray(value)) throw new Error(`Expected list at ${path}`);
  return value;
}

function solicitationSourceIds(draft: unknown): string[] {
  return draftList(draft, "evidenceRefs")
    .map((value) => mutableRecord(value, "evidenceRefs"))
    .filter((value) => value.kind === "solicitation")
    .map((value) => String(value.id));
}

function ensureRequiredGuarantee(draft: unknown): void {
  const sourceIds = solicitationSourceIds(draft);
  if (sourceIds.length === 0) throw new Error("Fixture requires solicitation evidence");
  writeDraftPath(draft, "source.guaranteeRequirement", {
    required: true,
    allowedMethods: ["银行保函"],
    amountMinor: "1",
    sourceRefIds: [sourceIds[0]],
  });
}

function ensureBidGuarantee(draft: unknown): void {
  if (readDraftPath(draft, "bidGuarantee") !== undefined) return;
  writeDraftPath(draft, "bidGuarantee", {
    method: "银行保函",
    amountMinor: "1",
    reference: "editor-guarantee",
    userConfirmed: false,
  });
}

function addFixtureAttachment(draft: unknown, id: string): string {
  const attachments = draftList(draft, "attachments");
  const source = attachments.find(
    (value) => mutableRecord(value, "attachments").status === "attached",
  );
  if (!source) throw new Error("Fixture requires an attached descriptor");
  attachments.push({
    ...clone(mutableRecord(source, "attachments")),
    id,
    displayName: `${id}.pdf`,
  });
  return id;
}

function dynamicSourceValues(draft: unknown, field: TemplateFieldManifestEntryV1): string[] {
  if (!("optionSourcePath" in field) || typeof field.optionSourcePath !== "string") return [];
  const filter = "optionFilter" in field ? field.optionFilter : undefined;
  return draftList(draft, field.optionSourcePath)
    .map((value) => mutableRecord(value, field.optionSourcePath))
    .filter((value) => filter === undefined || readDraftPath(value, filter.path) === filter.equals)
    .map((value) => String(readDraftPath(value, field.optionValuePath)));
}

function mutateBidEditorField(draft: unknown, field: TemplateFieldManifestEntryV1): void {
  const { path } = field;
  if (field.control === "repeatable") return;
  if (path.startsWith("bidGuarantee.")) ensureBidGuarantee(draft);
  if (
    path === "source.guaranteeRequirement.required" ||
    path === "source.guaranteeRequirement.amountMinor" ||
    path === "source.guaranteeRequirement.sourceRefIds"
  ) {
    ensureRequiredGuarantee(draft);
    if (path === "source.guaranteeRequirement.required") return;
    if (path === "source.guaranteeRequirement.amountMinor") {
      writeDraftPath(draft, path, "2");
      return;
    }
    const sourceIds = dynamicSourceValues(draft, field);
    if (sourceIds.length < 2) throw new Error("Fixture requires two filtered source options");
    writeDraftPath(draft, path, sourceIds.slice(0, 2));
    return;
  }
  if (path === "projectManager" && Array.isArray(readDraftPath(draft, "staffing"))) {
    const staffing = draftList(draft, "staffing");
    staffing.push({
      id: "editor-manager",
      name: "编辑项目经理",
      role: "项目经理",
      qualification: "合法资质",
      experience: "合法经验",
      allocation: "全职",
      userConfirmedTruth: true,
    });
    writeDraftPath(draft, path, "编辑项目经理");
    return;
  }
  if (field.control === "attachment") {
    const attachmentId = addFixtureAttachment(draft, `editor-${path.replaceAll(".", "-")}`);
    writeDraftPath(
      draft,
      path,
      field.valueKind === "attachment-id-list" ? [attachmentId] : attachmentId,
    );
    return;
  }
  const current = readDraftPath(draft, path);
  if (field.control === "select" && field.valueKind === "enum") {
    const replacement = field.options.find((option) => option.value !== current)?.value;
    if (replacement === undefined) throw new Error(`Select ${path} requires a second option`);
    writeDraftPath(draft, path, replacement);
    return;
  }
  if (field.control === "select" && field.valueKind === "string-list") {
    const values = dynamicSourceValues(draft, field);
    if (values.length === 0) throw new Error(`Dynamic select ${path} has no valid source`);
    writeDraftPath(draft, path, values);
    return;
  }
  if (field.valueKind === "string" || field.valueKind === "localized-text") {
    writeDraftPath(draft, path, `${typeof current === "string" ? current : "内容"} 已编辑`);
    return;
  }
  if (field.valueKind === "date") {
    writeDraftPath(draft, path, current === "2026-08-18" ? "2026-08-19" : "2026-08-18");
    return;
  }
  if (field.valueKind === "offset-datetime") {
    const instant = new Date(String(current));
    if (!Number.isFinite(instant.getTime())) throw new Error(`Invalid fixture datetime at ${path}`);
    instant.setUTCMinutes(instant.getUTCMinutes() + (path === "source.bidDeadline" ? -1 : 1));
    writeDraftPath(draft, path, instant.toISOString());
    return;
  }
  if (field.valueKind === "integer") {
    const numeric = Number(current);
    writeDraftPath(draft, path, numeric >= 100 ? numeric - 1 : numeric + 1);
    return;
  }
  if (field.valueKind === "decimal-string") {
    writeDraftPath(draft, path, current === "1" ? "2" : "1");
    return;
  }
  if (field.valueKind === "money-minor") {
    writeDraftPath(draft, path, (BigInt(String(current ?? "0")) + 1n).toString());
    return;
  }
  if (field.valueKind === "basis-points") {
    writeDraftPath(draft, path, Number(current) === 1 ? 2 : 1);
    return;
  }
  if (field.valueKind === "boolean") {
    writeDraftPath(draft, path, !current);
    return;
  }
  throw new Error(`No legal mutation for ${path}:${field.control}/${field.valueKind}`);
}

function firstDraftRecord(draft: unknown, path: string): MutableRecord {
  const first = draftList(draft, path)[0];
  if (first === undefined) throw new Error(`Fixture requires a row at ${path}`);
  return mutableRecord(first, path);
}

function canonicalDeviation(requirement: MutableRecord): MutableRecord {
  return {
    requirementId: String(requirement.id),
    type: "business",
    sourceRefIds: clone(requirement.sourceRefIds),
    requirement: String(requirement.requirementText),
    response: String(requirement.responseText || "合法响应"),
    deviation: "合法偏差",
  };
}

function prepareRepeatableFactoryDraft(
  draft: unknown,
  path: string,
  fallbackId: string,
): { readonly draft: unknown; readonly inputId: string } {
  if (path === "source.versionEvidence.clarificationAttachments") {
    draftList(draft, "source.clarificationIds").push(fallbackId);
  }
  if (path === "source.guaranteeRequirement.allowedMethods") ensureRequiredGuarantee(draft);
  if (path === "businessDeviations" || path === "technicalDeviations") {
    const requirement = firstDraftRecord(draft, "requirements");
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(requirement.id) };
  }
  if (path === "technicalMatrix" || path === "businessMatrix") {
    const category = path === "technicalMatrix" ? "technical" : "commercial";
    const requirement = draftList(draft, "requirements")
      .map((value) => mutableRecord(value, "requirements"))
      .find((value) => value.category === category);
    if (!requirement) throw new Error(`Fixture requires a ${category} requirement`);
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(requirement.id) };
  }
  if (path === "requirementMatrix") {
    const requirement = firstDraftRecord(draft, "requirements");
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(requirement.id) };
  }
  if (path === "performanceEvidence" || path === "caseStudies") {
    const reference = firstDraftRecord(draft, "projectReferences");
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(reference.id) };
  }
  if (path === "projectManager.experience") {
    const reference = firstDraftRecord(draft, "projectReferences");
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(reference.id) };
  }
  if (path === "contractAcceptanceDeviations" || path === "contractDeviations") {
    const requirement = firstDraftRecord(draft, "requirements");
    writeDraftPath(draft, "businessDeviations", [canonicalDeviation(requirement)]);
    writeDraftPath(draft, path, []);
    return { draft, inputId: String(requirement.id) };
  }
  return { draft, inputId: fallbackId };
}

const READY_EVALUATION_CONTEXT = { asOf: "2026-08-20T12:00:00+08:00" } as const;

describe("bid.government.goods.v1", () => {
  it("registers its source basis and compiles a verified fixture in stable order", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-government-goods"));
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );

    expect(registration.definition).toMatchObject({
      id: "bid.government.goods.v1",
      version: "1.0.0",
      category: "bid",
      basisDate: "2026-08-19",
      defaultLayout: "classic-formal.v1",
      sourceKeys: ["mof-order-87", "mof-demand-management"],
      disclaimerProfile: "bid",
    });
    expect(model.sections.map((section) => section.id)).toEqual(GOVERNMENT_GOODS_SECTIONS);
    expect(model.watermarks).toEqual([]);
    expect(model.disclaimers).toEqual(["bid-authority"]);
    expect(JSON.stringify(model)).toContain("CNY 10,000.00");
    expect(JSON.stringify(model)).toContain("中小企业政策");
    expect(JSON.stringify(model)).not.toContain("此项尚未核实，不得形成肯定声明");
  });
});

describe("bid.government.services.v1", () => {
  it("registers its source basis and compiles truthful staff and performance evidence", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.services.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-government-services"));
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );

    expect(registration.definition).toMatchObject({
      id: "bid.government.services.v1",
      version: "1.0.0",
      category: "bid",
      basisDate: "2026-08-19",
      defaultLayout: "classic-formal.v1",
      sourceKeys: ["mof-order-87", "mof-demand-management"],
      disclaimerProfile: "bid",
    });
    expect(model.sections.map((section) => section.id)).toEqual(GOVERNMENT_SERVICES_SECTIONS);
    expect(model.watermarks).toEqual([]);
    expect(JSON.stringify(model)).toContain("赵示例");
    expect(JSON.stringify(model)).toContain("热线接通率");
    expect(JSON.stringify(model)).toContain("CNY 10,000.00");
  });
});

describe("bid.construction.works.v1", () => {
  it("compiles only source-backed BOQ, manager, personnel and equipment facts", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.construction.works.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-construction-works"));
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );

    expect(registration.definition).toMatchObject({
      id: "bid.construction.works.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLayout: "classic-formal.v1",
      sourceKeys: [
        "prc-tendering-law",
        "ndrc-standard-construction",
        "ndrc-tenderer-responsibility",
      ],
    });
    expect(model.sections.map((section) => section.id)).toEqual(CONSTRUCTION_WORKS_SECTIONS);
    expect(model.watermarks).toEqual([]);
    for (const id of ["priced-boq", "commercial-deviations", "technical-deviations", "equipment"]) {
      expect(model.sections.find((section) => section.id === id)?.page?.orientation).toBe(
        "landscape",
      );
    }
    expect(JSON.stringify(model)).toContain("boq-main");
    expect(JSON.stringify(model)).toContain("赵示例");
    expect(JSON.stringify(model)).toContain("CNY 50,000.00");
  });
});

describe("bid.enterprise.goods.v1", () => {
  it("keeps the law source contextual and renders optional continuity details explicitly", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.enterprise.goods.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-enterprise-goods"));
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );
    const serialized = JSON.stringify(model);

    expect(registration.definition).toMatchObject({
      id: "bid.enterprise.goods.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLayout: "modern-business.v1",
      sourceKeys: ["prc-tendering-law"],
    });
    expect(model.sections.map((section) => section.id)).toEqual(ENTERPRISE_GOODS_SECTIONS);
    expect(model.watermarks).toEqual([]);
    expect(serialized).toContain("是否适用招标法律规则取决于项目和采购主体");
    expect(serialized).toContain("供应连续性：未提供");
    expect(serialized).toContain("库存方案：未提供");
    expect(serialized).toContain("厂商支持：未提供");
    expect(serialized).toContain("CNY 8,000.00");
  });
});

describe("bid.enterprise.services.v1", () => {
  it("keeps assumptions, dependencies and exclusions separately reviewable", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.enterprise.services.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-enterprise-services"));
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );
    const separation = model.sections.find(
      (section) => section.id === "assumptions-dependencies-exclusions",
    );

    expect(registration.definition).toMatchObject({
      id: "bid.enterprise.services.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      defaultLayout: "modern-business.v1",
      sourceKeys: ["prc-tendering-law"],
    });
    expect(model.sections.map((section) => section.id)).toEqual(ENTERPRISE_SERVICES_SECTIONS);
    expect(model.watermarks).toEqual([]);
    expect(separation?.blocks.map((block) => block.id)).toEqual([
      "enterprise-service-assumptions",
      "enterprise-service-dependencies",
      "enterprise-service-exclusions",
    ]);
    expect(JSON.stringify(model)).toContain("是否适用招标法律规则取决于项目和采购主体");
    expect(JSON.stringify(model)).toContain("CNY 9,000.00");
  });
});

it("registers exactly fourteen immutable unique V2 template versions on one basis date", () => {
  const definitions = V2_TEMPLATE_REGISTRY.list().map((registration) => registration.definition);
  const keys = definitions.map((definition) => `${definition.id}@${definition.version}`);

  expect(definitions).toHaveLength(14);
  expect(new Set(keys).size).toBe(14);
  expect(definitions.filter((definition) => definition.category === "quotation")).toHaveLength(4);
  expect(definitions.filter((definition) => definition.category === "contract")).toHaveLength(5);
  expect(definitions.filter((definition) => definition.category === "bid")).toHaveLength(5);
  expect(definitions.every((definition) => definition.basisDate === "2026-08-19")).toBe(true);
  expect(definitions.every((definition) => Object.isFrozen(definition))).toBe(true);
});

const BID_BASE_EDITOR_PATHS = [
  "authorizedRepresentative",
  "bidGuarantee.amountMinor",
  "bidGuarantee.attachmentId",
  "bidGuarantee.method",
  "bidGuarantee.reference",
  "bidGuarantee.userConfirmed",
  "bidder.authorizedRepresentative",
  "bidder.bankAccount",
  "bidder.bankAccountName",
  "bidder.bankName",
  "bidder.contactName",
  "bidder.email",
  "bidder.englishName",
  "bidder.entityType",
  "bidder.legalName",
  "bidder.legalRepresentative",
  "bidder.phone",
  "bidder.postalAddress",
  "bidder.registeredAddress",
  "bidder.registrationId",
  "bidder.swiftCode",
  "bidder.taxId",
  "businessDeviations",
  "consortiumMembers",
  "evidenceRefs",
  "finalReviewers",
  "priceDeclaration.bidLetterTotalMinor",
  "priceDeclaration.itemizedTotalMinor",
  "priceDeclaration.openingTotalMinor",
  "priceDeclaration.userConfirmed",
  "projectReferences",
  "qualifications",
  "requirements",
  "signSealChecklist",
  "source.agency",
  "source.bidDeadline",
  "source.bidValidityDays",
  "source.clarificationIds",
  "source.currency",
  "source.evaluationMethod",
  "source.guaranteeRequirement.allowedMethods",
  "source.guaranteeRequirement.amountMinor",
  "source.guaranteeRequirement.required",
  "source.guaranteeRequirement.sourceRefIds",
  "source.issueDate",
  "source.issuer",
  "source.jointVentureAllowed",
  "source.maximumPriceMinor",
  "source.openingPlace",
  "source.openingTime",
  "source.packageNumber",
  "source.projectName",
  "source.projectNumber",
  "source.sealingRules",
  "source.signatureRules",
  "source.subcontractAllowed",
  "source.submissionCopies.copies",
  "source.submissionCopies.electronic",
  "source.submissionCopies.original",
  "source.submissionMode",
  "source.taxBasis",
  "source.versionEvidence.allClarificationsIncluded",
  "source.versionEvidence.clarificationAttachments",
  "source.versionEvidence.mainSolicitationAttachmentId",
  "source.versionEvidence.userConfirmedExactVersion",
  "source.versionLabel",
  "technicalDeviations",
] as const;

const BID_NON_EDITOR_PATH_ALLOWLIST = [
  "attachments",
  "id",
  "templateId",
  "templateVersion",
  "updatedAt",
] as const;

const BID_EDITOR_CASES = [
  {
    id: "bid.government.goods.v1",
    fixtureName: "bid-government-goods",
    representativeRepeatable: "goodsOfferLines",
    repeatablePaths: [
      "source.clarificationIds",
      "source.versionEvidence.clarificationAttachments",
      "source.guaranteeRequirement.allowedMethods",
      "consortiumMembers",
      "requirements",
      "qualifications",
      "evidenceRefs",
      "businessDeviations",
      "technicalDeviations",
      "projectReferences",
      "signSealChecklist",
      "finalReviewers",
      "goodsOfferLines",
      "technicalMatrix",
      "businessMatrix",
      "policyDeclarations",
    ],
    specializedPaths: [
      "coreProduct",
      "goodsOfferLines",
      "technicalMatrix",
      "businessMatrix",
      "plans.delivery",
      "plans.installation",
      "plans.training",
      "plans.acceptance",
      "plans.warranty",
      "plans.afterSales",
      "policyDeclarations",
    ],
  },
  {
    id: "bid.government.services.v1",
    fixtureName: "bid-government-services",
    representativeRepeatable: "workPackages",
    repeatablePaths: [
      "source.clarificationIds",
      "source.versionEvidence.clarificationAttachments",
      "source.guaranteeRequirement.allowedMethods",
      "consortiumMembers",
      "requirements",
      "qualifications",
      "evidenceRefs",
      "businessDeviations",
      "technicalDeviations",
      "projectReferences",
      "signSealChecklist",
      "finalReviewers",
      "workPackages",
      "deliverables",
      "milestones",
      "sla",
      "staffing",
      "servicePriceLines",
      "performanceEvidence",
      "policyDeclarations",
    ],
    specializedPaths: [
      "serviceUnderstanding",
      "objectives",
      "methodology",
      "workPackages",
      "deliverables",
      "milestones",
      "sla",
      "staffing",
      "projectManager",
      "qualityPlan",
      "riskPlan",
      "securityPlan",
      "privacyPlan",
      "businessContinuity",
      "acceptancePlan",
      "servicePriceLines",
      "performanceEvidence",
      "policyDeclarations",
    ],
  },
  {
    id: "bid.construction.works.v1",
    fixtureName: "bid-construction-works",
    representativeRepeatable: "keyTechnicalPersonnel",
    repeatablePaths: [
      "source.clarificationIds",
      "source.versionEvidence.clarificationAttachments",
      "source.guaranteeRequirement.allowedMethods",
      "consortiumMembers",
      "requirements",
      "qualifications",
      "evidenceRefs",
      "businessDeviations",
      "technicalDeviations",
      "projectReferences",
      "signSealChecklist",
      "finalReviewers",
      "projectManager.experience",
      "keyTechnicalPersonnel",
      "laborPlan",
      "equipmentList",
    ],
    specializedPaths: [
      "projectScope",
      "billOfQuantitiesRef",
      "bidPriceMinor",
      "durationDays",
      "qualityTarget",
      "projectManager.name",
      "projectManager.qualification",
      "projectManager.certificateNumber",
      "projectManager.experience",
      "projectManager.userConfirmedTruth",
      "keyTechnicalPersonnel",
      "laborPlan",
      "equipmentList",
      "constructionOrganization",
      "schedulePlan",
      "sitePlan",
      "qualityPlan",
      "safetyPlan",
      "environmentPlan",
      "emergencyPlan",
      "subcontractPlan",
      "materialsPlan",
      "temporaryWorks",
    ],
  },
  {
    id: "bid.enterprise.goods.v1",
    fixtureName: "bid-enterprise-goods",
    representativeRepeatable: "goodsOfferLines",
    repeatablePaths: [
      "source.clarificationIds",
      "source.versionEvidence.clarificationAttachments",
      "source.guaranteeRequirement.allowedMethods",
      "consortiumMembers",
      "requirements",
      "qualifications",
      "evidenceRefs",
      "businessDeviations",
      "technicalDeviations",
      "projectReferences",
      "signSealChecklist",
      "finalReviewers",
      "goodsOfferLines",
      "requirementMatrix",
      "contractAcceptanceDeviations",
    ],
    specializedPaths: [
      "executiveSummary",
      "goodsOfferLines",
      "requirementMatrix",
      "commercialOffer",
      "technicalOffer",
      "deliveryPlan",
      "qualityAssurance",
      "inspectionAcceptance",
      "warranty",
      "afterSales",
      "supplyContinuity",
      "inventoryPlan",
      "manufacturerSupport",
      "contractAcceptanceDeviations",
    ],
  },
  {
    id: "bid.enterprise.services.v1",
    fixtureName: "bid-enterprise-services",
    representativeRepeatable: "deliverables",
    repeatablePaths: [
      "source.clarificationIds",
      "source.versionEvidence.clarificationAttachments",
      "source.guaranteeRequirement.allowedMethods",
      "consortiumMembers",
      "requirements",
      "qualifications",
      "evidenceRefs",
      "businessDeviations",
      "technicalDeviations",
      "projectReferences",
      "signSealChecklist",
      "finalReviewers",
      "deliverables",
      "milestones",
      "team",
      "sla",
      "assumptions",
      "dependencies",
      "exclusions",
      "servicePriceLines",
      "caseStudies",
      "riskRegister",
      "contractDeviations",
    ],
    specializedPaths: [
      "executiveSummary",
      "customerUnderstanding",
      "objectives",
      "scope",
      "methodology",
      "deliverables",
      "milestones",
      "team",
      "governance",
      "communicationPlan",
      "sla",
      "qualityPlan",
      "securityPrivacy",
      "assumptions",
      "dependencies",
      "exclusions",
      "servicePriceLines",
      "caseStudies",
      "riskRegister",
      "contractDeviations",
    ],
  },
] as const;

describe("five complete bid editor manifests", () => {
  for (const bidCase of BID_EDITOR_CASES) {
    it(`${bidCase.id} types the source, deadline, price and final-review authoring paths`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(bidCase.id, "1.0.0");
      const fields = registration.definition.fieldManifest;
      const paths = fields.map((field) => field.path);
      expect(fields.length).toBeGreaterThan(50);
      expect(new Set(paths).size).toBe(paths.length);
      expect(fields.every((field) => field.valueKind !== undefined)).toBe(true);
      expect([...paths].sort()).toEqual(
        [...BID_BASE_EDITOR_PATHS, ...bidCase.specializedPaths].sort(),
      );
      for (const path of BID_NON_EDITOR_PATH_ALLOWLIST) expect(paths).not.toContain(path);
      expect(() => registration.parseDraft(fixture(bidCase.fixtureName))).not.toThrow();
    });

    it(`${bidCase.id} creates a representative authored row through its exact parser`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(bidCase.id, "1.0.0");
      const draft = registration.parseDraft(fixture(bidCase.fixtureName));
      expect(() =>
        registration.createRepeatableItem(bidCase.representativeRepeatable, {
          id: "editor-new-row",
          now: "2026-08-20T00:00:00.000Z",
          draft,
        }),
      ).not.toThrow();
    });

    it(`${bidCase.id} accepts a distinct legal mutation for every scalar editor path`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(bidCase.id, "1.0.0");
      const parsed = registration.parseDraft(fixture(bidCase.fixtureName));
      for (const field of registration.definition.fieldManifest) {
        if (field.control === "repeatable") continue;
        const candidate = clone(parsed);
        const before = clone(readDraftPath(candidate, field.path));
        mutateBidEditorField(candidate, field);
        expect(readDraftPath(candidate, field.path), field.path).not.toEqual(before);
        expect(() => registration.parseDraft(candidate), field.path).not.toThrow();
      }
    });

    it(`${bidCase.id} publishes a parser-backed factory for every repeatable path`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(bidCase.id, "1.0.0");
      const actualPaths = registration.definition.fieldManifest
        .filter((field) => field.control === "repeatable")
        .map((field) => field.path)
        .sort();
      expect(actualPaths).toEqual([...bidCase.repeatablePaths].sort());

      bidCase.repeatablePaths.forEach((path, index) => {
        const initial = clone(registration.parseDraft(fixture(bidCase.fixtureName)));
        const prepared = prepareRepeatableFactoryDraft(initial, path, `editor-row-${index}`);
        const parsed = registration.parseDraft(prepared.draft);
        const item = registration.createRepeatableItem(path, {
          id: prepared.inputId,
          now: "2026-08-20T00:00:00.000Z",
          draft: parsed,
        });
        const candidate = clone(parsed);
        draftList(candidate, path).push(clone(item));
        expect(() => registration.parseDraft(candidate), path).not.toThrow();
        const manifest = registration.definition.fieldManifest.find((field) => field.path === path);
        draftList(candidate, path).pop();
        expect(() => registration.parseDraft(candidate), `${path}:delete`).not.toThrow();
        draftList(candidate, path).push(clone(item));
        draftList(candidate, path).reverse();
        const reordered = registration.parseDraft(candidate);
        if (
          manifest?.control === "repeatable" &&
          manifest.valueKind === "object-list" &&
          manifest.item.idPath
        ) {
          expect(
            draftList(reordered, path).some(
              (entry) => readDraftPath(entry, manifest.item.idPath ?? "") === prepared.inputId,
            ),
            `${path}:identity`,
          ).toBe(true);
        }
        if (manifest?.valueKind === "string-list") {
          expect(item, path).not.toBe(prepared.inputId);
        }
      });
    });
  }

  it("describes all seventeen nested bid array semantics without plain-text stand-ins", () => {
    const itemField = (templateId: string, listPath: string, fieldPath: string) => {
      const field = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").definition.fieldManifest.find(
        (entry) => entry.path === listPath,
      );
      expect(field?.control).toBe("repeatable");
      if (field?.control !== "repeatable" || field.valueKind !== "object-list") {
        throw new Error(`Expected object-list metadata for ${templateId}:${listPath}`);
      }
      const nested = field.item.fields.find((entry) => entry.path === fieldPath);
      expect(nested).toBeDefined();
      return nested;
    };
    const expectDynamic = (
      templateId: string,
      listPath: string,
      fieldPath: string,
      optionSourcePath: string,
      optionKind: "solicitation" | "proof",
    ) => {
      expect(itemField(templateId, listPath, fieldPath)).toMatchObject({
        control: "select",
        valueKind: "string-list",
        multiple: true,
        optionSourcePath,
        optionValuePath: "id",
        optionFilter: { path: "kind", equals: optionKind },
      });
    };

    for (const { id } of BID_EDITOR_CASES) {
      expect(
        V2_TEMPLATE_REGISTRY.get(id, "1.0.0").definition.fieldManifest.find(
          (entry) => entry.path === "source.guaranteeRequirement.sourceRefIds",
        ),
      ).toMatchObject({
        control: "select",
        valueKind: "string-list",
        multiple: true,
        minItems: 0,
        maxItems: 100,
        optionSourcePath: "evidenceRefs",
        optionValuePath: "id",
        optionLabelPath: "sourceRef",
        optionFilter: { path: "kind", equals: "solicitation" },
      });
      expectDynamic(id, "requirements", "sourceRefIds", "evidenceRefs", "solicitation");
      expectDynamic(id, "requirements", "evidenceRefIds", "evidenceRefs", "proof");
      expectDynamic(id, "qualifications", "sourceRefIds", "evidenceRefs", "solicitation");
      expectDynamic(id, "businessDeviations", "sourceRefIds", "evidenceRefs", "solicitation");
      expectDynamic(id, "technicalDeviations", "sourceRefIds", "evidenceRefs", "solicitation");
      expectDynamic(id, "signSealChecklist", "sourceRefIds", "evidenceRefs", "solicitation");
      for (const deviationPath of ["businessDeviations", "technicalDeviations"]) {
        expect(itemField(id, deviationPath, "requirementId")).toMatchObject({
          control: "select",
          valueKind: "string",
          multiple: false,
          optionSourcePath: "requirements",
          optionValuePath: "id",
          optionLabelPath: "requirementText",
        });
        expect(itemField(id, deviationPath, "type")).toMatchObject({
          control: "select",
          valueKind: "enum",
          options: [
            {
              value: deviationPath === "businessDeviations" ? "business" : "technical",
            },
          ],
        });
      }
    }
    for (const matrix of ["technicalMatrix", "businessMatrix"]) {
      expectDynamic(
        "bid.government.goods.v1",
        matrix,
        "sourceRefIds",
        "evidenceRefs",
        "solicitation",
      );
      expectDynamic("bid.government.goods.v1", matrix, "evidenceRefIds", "evidenceRefs", "proof");
      expect(itemField("bid.government.goods.v1", matrix, "category")).toMatchObject({
        control: "select",
        valueKind: "enum",
        options: [{ value: matrix === "technicalMatrix" ? "technical" : "commercial" }],
      });
    }
    expect(
      itemField("bid.government.goods.v1", "policyDeclarations", "evidenceAttachmentIds"),
    ).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id-list",
      cardinality: "multiple",
      role: "supporting",
      category: "qualification",
      includeInSubmissionDefault: true,
    });
    expect(itemField("bid.government.services.v1", "workPackages", "deliverables")).toMatchObject({
      control: "repeatable",
      valueKind: "string-list",
    });
    expect(
      itemField("bid.government.services.v1", "policyDeclarations", "evidenceAttachmentIds"),
    ).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id-list",
      cardinality: "multiple",
    });
    expectDynamic(
      "bid.enterprise.goods.v1",
      "requirementMatrix",
      "sourceRefIds",
      "evidenceRefs",
      "solicitation",
    );
    expectDynamic(
      "bid.enterprise.goods.v1",
      "requirementMatrix",
      "evidenceRefIds",
      "evidenceRefs",
      "proof",
    );
    expectDynamic(
      "bid.enterprise.goods.v1",
      "contractAcceptanceDeviations",
      "sourceRefIds",
      "evidenceRefs",
      "solicitation",
    );
    expectDynamic(
      "bid.enterprise.services.v1",
      "contractDeviations",
      "sourceRefIds",
      "evidenceRefs",
      "solicitation",
    );
    for (const [templateId, path] of [
      ["bid.enterprise.goods.v1", "contractAcceptanceDeviations"],
      ["bid.enterprise.services.v1", "contractDeviations"],
    ] as const) {
      expect(itemField(templateId, path, "requirementId")).toMatchObject({
        control: "select",
        valueKind: "string",
        multiple: false,
        optionSourcePath: "requirements",
        optionValuePath: "id",
        optionLabelPath: "requirementText",
      });
      expect(itemField(templateId, path, "type")).toMatchObject({
        control: "select",
        valueKind: "enum",
        options: [{ value: "business" }],
      });
    }
    expect(
      itemField("bid.government.services.v1", "servicePriceLines", "milestoneId"),
    ).toMatchObject({
      control: "select",
      valueKind: "string",
      multiple: false,
      optionSourcePath: "milestones",
      optionValuePath: "id",
      optionLabelPath: "name",
    });
    expect(
      itemField("bid.enterprise.services.v1", "servicePriceLines", "milestoneId"),
    ).toMatchObject({
      control: "select",
      valueKind: "string",
      multiple: false,
      optionSourcePath: "milestones",
      optionValuePath: "id",
      optionLabelPath: "name",
    });
  });

  it("publishes the exact bid source and submission attachment policies", () => {
    const field = (templateId: string, path: string) =>
      V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").definition.fieldManifest.find(
        (entry) => entry.path === path,
      );
    expect(
      field("bid.government.goods.v1", "source.versionEvidence.mainSolicitationAttachmentId"),
    ).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id",
      cardinality: "single",
      maxItems: 1,
      descriptorPath: "attachments",
      role: "source",
      category: "other",
      allowedMediaTypes: ["application/pdf", "image/png", "image/jpeg"],
      pdfPageCount: "user-confirmed",
      includeInSubmissionDefault: false,
    });
    expect(field("bid.construction.works.v1", "billOfQuantitiesRef")).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id",
      cardinality: "single",
      maxItems: 1,
      descriptorPath: "attachments",
      role: "submission",
      category: "commercial",
      allowedMediaTypes: ["application/pdf", "image/png", "image/jpeg"],
      pdfPageCount: "user-confirmed",
      includeInSubmissionDefault: true,
    });
  });

  it("keeps Web session row ids out of authored string-list values", () => {
    for (const [templateId, fixtureName, path] of [
      ["bid.government.goods.v1", "bid-government-goods", "source.clarificationIds"],
      ["bid.enterprise.services.v1", "bid-enterprise-services", "assumptions"],
    ] as const) {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const value = registration.createRepeatableItem(path, {
        id: "web-session-row-key",
        now: "2026-08-20T00:00:00.000Z",
        draft: registration.parseDraft(fixture(fixtureName)),
      });
      expect(value).toBe("待填写");
      expect(value).not.toBe("web-session-row-key");
    }
  });
});

describe("five bid template security and canonical-reference matrix", () => {
  const cases = [
    ["bid.government.goods.v1", "bid-government-goods"],
    ["bid.government.services.v1", "bid-government-services"],
    ["bid.construction.works.v1", "bid-construction-works"],
    ["bid.enterprise.goods.v1", "bid-enterprise-goods"],
    ["bid.enterprise.services.v1", "bid-enterprise-services"],
  ] as const;

  it("uses only an explicit evaluation clock and fails closed when deadline evaluation is absent", () => {
    for (const [templateId, fixtureName] of cases) {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const base = fixture(fixtureName) as Record<string, unknown>;
      const staleUpdatedAt = { ...base, updatedAt: "2026-10-01T00:00:00+08:00" };

      expect(registration.preflight(staleUpdatedAt).map((finding) => finding.code)).toContain(
        "BID_DEADLINE_NOT_EVALUATED",
      );
      expect(
        DocumentModelV2Schema.parse(registration.compile(staleUpdatedAt)).watermarks[0]?.id,
      ).toBe("review-copy");
      expect(
        registration
          .preflight(staleUpdatedAt, READY_EVALUATION_CONTEXT)
          .map((finding) => finding.code),
      ).not.toContain("BID_DEADLINE_REACHED");
      expect(
        DocumentModelV2Schema.parse(registration.compile(staleUpdatedAt, READY_EVALUATION_CONTEXT))
          .watermarks,
      ).toEqual([]);
    }
  });

  for (const [templateId, fixtureName] of cases) {
    it(`${templateId} fails closed, freezes findings and strips local storage keys`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const base = fixture(fixtureName) as Record<string, unknown>;
      const parsed = registration.parseDraft(base);
      const findings = registration.preflight(parsed);
      expect(Object.isFrozen(findings)).toBe(true);
      expect(findings.map((finding) => RiskFindingV2Schema.parse(finding))).toEqual(findings);
      expect(findings.every((finding) => Object.isFrozen(finding))).toBe(true);
      expect(() => registration.parseDraft({ ...base, unknown: true })).toThrow();
      expect(() => registration.preflight({ ...base, unknown: true })).toThrow();
      expect(() => registration.compile({ ...base, unknown: true })).toThrow();

      const created = registration.createDraft({
        id: `${templateId}-created`,
        now: "2026-08-20T00:00:00Z",
      });
      expect(DocumentModelV2Schema.parse(registration.compile(created)).watermarks[0]?.id).toBe(
        "unbound-source",
      );
      const priceDeclaration = base.priceDeclaration as Record<string, unknown>;
      expect(
        DocumentModelV2Schema.parse(
          registration.compile({
            ...base,
            priceDeclaration: { ...priceDeclaration, userConfirmed: false },
          }),
        ).watermarks[0]?.id,
      ).toBe("review-copy");

      const getter = vi.fn(() => "不应执行");
      const accessor = { ...base };
      Object.defineProperty(accessor, "source", { enumerable: true, get: getter });
      expect(() => registration.parseDraft(accessor)).toThrow();
      expect(getter).not.toHaveBeenCalled();
      expect(() =>
        registration.parseDraft(Object.assign(Object.create({ inherited: true }), base)),
      ).toThrow();
      const { proxy, revoke } = Proxy.revocable(base, {});
      revoke();
      expect(() => registration.parseDraft(proxy)).toThrow();

      const attachments = clone(base.attachments as Array<Record<string, unknown>>);
      attachments[0] = {
        ...attachments[0],
        sourceRef: "blob:private-source",
        localBlobKey: "private-local-key",
      };
      const serialized = JSON.stringify(registration.compile({ ...base, attachments }));
      expect(serialized).not.toMatch(
        /bigint|blob:|data:|localBlobKey|private-local-key|private-source/,
      );

      const fillerAttachment = (index: number) => ({
        id: `extra-${index}`,
        category: "other",
        displayName: `extra-${index}.pdf`,
        mediaType: "application/pdf",
        required: false,
        status: "missing",
        includedInSubmission: false,
      });
      const exactAttachments = [
        ...(base.attachments as unknown[]),
        ...Array.from({ length: 100 - (base.attachments as unknown[]).length }, (_, index) =>
          fillerAttachment(index),
        ),
      ];
      expect(() =>
        registration.parseDraft({ ...base, attachments: exactAttachments }),
      ).not.toThrow();
      expect(() =>
        registration.parseDraft({
          ...base,
          attachments: [...exactAttachments, fillerAttachment(100)],
        }),
      ).toThrow();

      const originalRequirements = base.requirements as Array<Record<string, unknown>>;
      const sourceRefId = (originalRequirements[0]?.sourceRefIds as string[])[0] as string;
      const exactRequirements = [
        ...originalRequirements,
        ...Array.from({ length: 500 - originalRequirements.length }, (_, index) => ({
          id: `generated-requirement-${index}`,
          sourceRefIds: [sourceRefId],
          category: "technical",
          requirementText: `用户提供的要求 ${index}`,
          substantial: false,
          responseStatus: "not-started",
          responseText: "",
          compliance: "unreviewed",
          evidenceRefIds: [],
          reviewStatus: "pending",
        })),
      ];
      expect(() =>
        registration.parseDraft({ ...base, requirements: exactRequirements }),
      ).not.toThrow();
      expect(() =>
        registration.parseDraft({
          ...base,
          requirements: [
            ...exactRequirements,
            {
              ...exactRequirements.at(-1),
              id: "generated-requirement-overflow",
            },
          ],
        }),
      ).toThrow();

      const sparseAttachments = new Array(1);
      expect(() => registration.parseDraft({ ...base, attachments: sparseAttachments })).toThrow();
    });
  }

  it("rejects specialized response, experience, case and deviation rows that diverge from canonical base records", () => {
    const governmentGoods = fixture("bid-government-goods") as Record<string, unknown>;
    const technicalMatrix = clone(
      governmentGoods.technicalMatrix as Array<Record<string, unknown>>,
    );
    technicalMatrix[0] = { ...technicalMatrix[0], responseText: "与规范响应记录不一致" };
    expect(() =>
      V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0").parseDraft({
        ...governmentGoods,
        technicalMatrix,
      }),
    ).toThrow();

    const governmentServices = fixture("bid-government-services") as Record<string, unknown>;
    const performanceEvidence = clone(
      governmentServices.performanceEvidence as Array<Record<string, unknown>>,
    );
    performanceEvidence[0] = { ...performanceEvidence[0], projectName: "与规范业绩不一致" };
    expect(() =>
      V2_TEMPLATE_REGISTRY.get("bid.government.services.v1", "1.0.0").parseDraft({
        ...governmentServices,
        performanceEvidence,
      }),
    ).toThrow();

    const construction = fixture("bid-construction-works") as Record<string, unknown>;
    const projectManager = clone(construction.projectManager as Record<string, unknown>);
    const managerExperience = clone(projectManager.experience as Array<Record<string, unknown>>);
    managerExperience[0] = { ...managerExperience[0], scope: "与规范经历不一致" };
    expect(() =>
      V2_TEMPLATE_REGISTRY.get("bid.construction.works.v1", "1.0.0").parseDraft({
        ...construction,
        projectManager: { ...projectManager, experience: managerExperience },
      }),
    ).toThrow();

    const enterpriseGoods = fixture("bid-enterprise-goods") as Record<string, unknown>;
    const requirementMatrix = clone(
      enterpriseGoods.requirementMatrix as Array<Record<string, unknown>>,
    );
    requirementMatrix[0] = { ...requirementMatrix[0], offeredValue: "与规范响应值不一致" };
    expect(() =>
      V2_TEMPLATE_REGISTRY.get("bid.enterprise.goods.v1", "1.0.0").parseDraft({
        ...enterpriseGoods,
        requirementMatrix,
      }),
    ).toThrow();

    const enterpriseServices = fixture("bid-enterprise-services") as Record<string, unknown>;
    const caseStudies = clone(enterpriseServices.caseStudies as Array<Record<string, unknown>>);
    caseStudies[0] = { ...caseStudies[0], customer: "与规范案例不一致" };
    expect(() =>
      V2_TEMPLATE_REGISTRY.get("bid.enterprise.services.v1", "1.0.0").parseDraft({
        ...enterpriseServices,
        caseStudies,
      }),
    ).toThrow();
  });

  it("blocks required specialized narrative placeholders instead of treating them as authored facts", () => {
    const governmentGoods = fixture("bid-government-goods") as Record<string, unknown>;
    expect(
      V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0")
        .preflight({
          ...governmentGoods,
          plans: {
            ...(governmentGoods.plans as Record<string, unknown>),
            delivery: "待填写",
          },
        })
        .map((finding) => finding.code),
    ).toContain("BID_GOODS_DELIVERY_PLAN_MISSING");

    const governmentServices = fixture("bid-government-services") as Record<string, unknown>;
    expect(
      V2_TEMPLATE_REGISTRY.get("bid.government.services.v1", "1.0.0")
        .preflight({ ...governmentServices, methodology: "待填写" })
        .map((finding) => finding.code),
    ).toContain("BID_SERVICE_METHODOLOGY_MISSING");

    const construction = fixture("bid-construction-works") as Record<string, unknown>;
    expect(
      V2_TEMPLATE_REGISTRY.get("bid.construction.works.v1", "1.0.0")
        .preflight({ ...construction, constructionOrganization: "待填写" })
        .map((finding) => finding.code),
    ).toContain("BID_CONSTRUCTION_ORGANIZATION_MISSING");
  });

  it("recursively blocks required nested goods, service, personnel, SLA, case and equipment placeholders", () => {
    const assertBlockedPath = (
      templateId: (typeof cases)[number][0],
      draft: Record<string, unknown>,
      path: readonly string[],
    ) => {
      expect(
        V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").preflight(draft, READY_EVALUATION_CONTEXT),
      ).toContainEqual(
        expect.objectContaining({
          code: "BID_REQUIRED_CONTENT_PLACEHOLDER",
          impact: "blockSubmission",
          path,
        }),
      );
    };

    const governmentGoods = fixture("bid-government-goods") as Record<string, unknown>;
    const governmentGoodsLines = clone(
      governmentGoods.goodsOfferLines as Array<Record<string, unknown>>,
    );
    governmentGoodsLines[0] = { ...governmentGoodsLines[0], name: "TBD" };
    assertBlockedPath(
      "bid.government.goods.v1",
      { ...governmentGoods, goodsOfferLines: governmentGoodsLines },
      ["goodsOfferLines", "0", "name"],
    );

    const governmentServices = fixture("bid-government-services") as Record<string, unknown>;
    const serviceLines = clone(
      governmentServices.servicePriceLines as Array<Record<string, unknown>>,
    );
    serviceLines[0] = { ...serviceLines[0], serviceName: "TODO" };
    const staffing = clone(governmentServices.staffing as Array<Record<string, unknown>>);
    staffing[0] = { ...staffing[0], name: "待填写" };
    const sla = clone(governmentServices.sla as Array<Record<string, unknown>>);
    sla[0] = { ...sla[0], metric: "待确认" };
    const governmentServicePlaceholders = {
      ...governmentServices,
      projectManager: "待填写",
      servicePriceLines: serviceLines,
      staffing,
      sla,
    };
    for (const path of [
      ["servicePriceLines", "0", "serviceName"],
      ["staffing", "0", "name"],
      ["sla", "0", "metric"],
    ]) {
      assertBlockedPath("bid.government.services.v1", governmentServicePlaceholders, path);
    }

    const construction = fixture("bid-construction-works") as Record<string, unknown>;
    const equipment = clone(construction.equipmentList as Array<Record<string, unknown>>);
    equipment[0] = { ...equipment[0], name: "未提供" };
    assertBlockedPath("bid.construction.works.v1", { ...construction, equipmentList: equipment }, [
      "equipmentList",
      "0",
      "name",
    ]);

    const enterpriseGoods = fixture("bid-enterprise-goods") as Record<string, unknown>;
    const enterpriseGoodsLines = clone(
      enterpriseGoods.goodsOfferLines as Array<Record<string, unknown>>,
    );
    enterpriseGoodsLines[0] = { ...enterpriseGoodsLines[0], name: "TBC" };
    assertBlockedPath(
      "bid.enterprise.goods.v1",
      { ...enterpriseGoods, goodsOfferLines: enterpriseGoodsLines },
      ["goodsOfferLines", "0", "name"],
    );

    const enterpriseServices = fixture("bid-enterprise-services") as Record<string, unknown>;
    const projectReferences = clone(
      enterpriseServices.projectReferences as Array<Record<string, unknown>>,
    );
    projectReferences[0] = { ...projectReferences[0], projectName: "未绑定" };
    const caseStudies = clone(projectReferences);
    assertBlockedPath(
      "bid.enterprise.services.v1",
      { ...enterpriseServices, projectReferences, caseStudies },
      ["caseStudies", "0", "projectName"],
    );
  });

  it("blocks placeholder tokens inside specialized text and required base bidder or qualification facts", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const base = fixture("bid-government-goods") as Record<string, unknown>;
    const expectBlocked = (
      draft: Record<string, unknown>,
      paths: readonly (readonly string[])[],
    ) => {
      const findings = registration.preflight(draft, READY_EVALUATION_CONTEXT);
      for (const path of paths) {
        expect(findings).toContainEqual(
          expect.objectContaining({ code: "BID_REQUIRED_CONTENT_PLACEHOLDER", path }),
        );
      }
      expect(
        DocumentModelV2Schema.parse(registration.compile(draft, READY_EVALUATION_CONTEXT))
          .watermarks[0]?.id,
      ).toBe("review-copy");
    };

    expectBlocked(
      {
        ...base,
        plans: {
          ...(base.plans as Record<string, unknown>),
          delivery: "交付日期：TBD",
        },
      },
      [["plans", "delivery"]],
    );

    const goodsOfferLines = clone(base.goodsOfferLines as Array<Record<string, unknown>>);
    goodsOfferLines[0] = { ...goodsOfferLines[0], name: "公共终端（待定）" };
    expectBlocked({ ...base, goodsOfferLines }, [["goodsOfferLines", "0", "name"]]);

    expectBlocked(
      {
        ...base,
        bidder: { ...(base.bidder as Record<string, unknown>), legalName: "TBD" },
      },
      [["bidder", "legalName"]],
    );

    const qualifications = clone(base.qualifications as Array<Record<string, unknown>>);
    qualifications[0] = {
      ...qualifications[0],
      name: "资格证书（待确认）",
      certificateNumber: "TODO",
    };
    expectBlocked({ ...base, qualifications }, [
      ["qualifications", "0", "name"],
      ["qualifications", "0", "certificateNumber"],
    ]);
  });

  it("normalizes disguised placeholders without blocking an ordinary factual sentence", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const base = fixture("bid-government-goods") as Record<string, unknown>;
    const withDelivery = (delivery: string) => ({
      ...base,
      plans: { ...(base.plans as Record<string, unknown>), delivery },
    });
    for (const delivery of ["交付日期：ＴＢＤ", "交付日期：T\u200BBD"]) {
      expect(
        registration.preflight(withDelivery(delivery), READY_EVALUATION_CONTEXT),
      ).toContainEqual(
        expect.objectContaining({
          code: "BID_REQUIRED_CONTENT_PLACEHOLDER",
          path: ["plans", "delivery"],
        }),
      );
      expect(
        DocumentModelV2Schema.parse(
          registration.compile(withDelivery(delivery), READY_EVALUATION_CONTEXT),
        ).watermarks[0]?.id,
      ).toBe("review-copy");
    }

    const factual = withDelivery("招标文件未提供既有系统接口文档，因此本方案包含现场核验。");
    expect(
      registration.preflight(factual, READY_EVALUATION_CONTEXT).map((finding) => finding.code),
    ).not.toContain("BID_REQUIRED_CONTENT_PLACEHOLDER");
    expect(
      DocumentModelV2Schema.parse(registration.compile(factual, READY_EVALUATION_CONTEXT))
        .watermarks,
    ).toEqual([]);
  });

  it("treats normalized placeholder tokens anywhere in exact source anchors as incomplete", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const base = fixture("bid-government-goods") as Record<string, unknown>;
    const source = base.source as Record<string, unknown>;
    for (const sourceOverride of [
      { versionLabel: "招标文件 TBD 版" },
      { signatureRules: "电子签章规则 T\u200BBD 待采购人澄清" },
    ]) {
      const model = DocumentModelV2Schema.parse(
        registration.compile(
          { ...base, source: { ...source, ...sourceOverride } },
          READY_EVALUATION_CONTEXT,
        ),
      );
      expect(model.watermarks[0]?.id).toBe("unbound-source");
    }
  });

  it("publishes only included attachments and strips URI or local-path source references", () => {
    const unsafeSourceRefs = [
      "blob:private-source",
      "data:application/pdf;base64,JVBERi0=",
      "file:///Users/example/private.pdf",
      "https://example.invalid/private.pdf",
      "http://example.invalid/private.pdf",
      "/Users/example/private.pdf",
      "~/Documents/private.pdf",
      "../private.pdf",
      "C:\\Users\\example\\private.pdf",
      "\\\\server\\private.pdf",
    ] as const;

    for (const [templateId, fixtureName] of cases) {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const base = fixture(fixtureName) as Record<string, unknown>;
      const originalAttachments = clone(base.attachments as Array<Record<string, unknown>>);
      const sourceId = (base.source as Record<string, unknown>).versionEvidence as Record<
        string,
        unknown
      >;
      const sourceAttachmentId = sourceId.mainSolicitationAttachmentId as string;

      for (const unsafeSourceRef of unsafeSourceRefs) {
        const attachments = clone(originalAttachments);
        attachments[0] = {
          ...attachments[0],
          includedInSubmission: false,
          localBlobKey: "private-local-key",
          sourceRef: "file:///Users/example/source.pdf",
        };
        attachments[1] = { ...attachments[1], sourceRef: unsafeSourceRef };
        const model = DocumentModelV2Schema.parse(
          registration.compile({ ...base, attachments }, READY_EVALUATION_CONTEXT),
        );
        expect(model.attachmentManifest.map((item) => item.id)).not.toContain(sourceAttachmentId);
        expect(model.attachmentManifest[0]).not.toHaveProperty("sourceRef");
        expect(JSON.stringify(model)).not.toMatch(
          /private-local-key|private\.pdf|example\.invalid/,
        );
      }

      const safeAttachments = clone(originalAttachments);
      const safeAttachmentId = safeAttachments[1]?.id as string;
      safeAttachments[1] = {
        ...safeAttachments[1],
        sourceRef: "用户确认的附件证据编号 A-1",
      };
      const safeModel = DocumentModelV2Schema.parse(
        registration.compile({ ...base, attachments: safeAttachments }, READY_EVALUATION_CONTEXT),
      );
      expect(
        safeModel.attachmentManifest.find((item) => item.id === safeAttachmentId)?.sourceRef,
      ).toBe("用户确认的附件证据编号 A-1");
    }
  });

  it("keeps the solicitation source attached locally but excludes it from submission fixtures", () => {
    for (const [templateId, fixtureName] of cases) {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const draft = registration.parseDraft(fixture(fixtureName)) as {
        readonly source: {
          readonly versionEvidence: { readonly mainSolicitationAttachmentId?: string };
        };
        readonly attachments: readonly {
          readonly id: string;
          readonly status: "missing" | "attached" | "rejected";
          readonly includedInSubmission: boolean;
        }[];
      };
      const sourceAttachmentId = draft.source.versionEvidence.mainSolicitationAttachmentId;
      const sourceAttachment = draft.attachments.find((item) => item.id === sourceAttachmentId);

      expect(sourceAttachment).toMatchObject({
        status: "attached",
        includedInSubmission: false,
      });
      expect(
        registration.preflight(draft, READY_EVALUATION_CONTEXT).map((finding) => finding.code),
      ).not.toContain("BID_SOURCE_ATTACHMENT_NOT_READY");

      const model = DocumentModelV2Schema.parse(
        registration.compile(draft, READY_EVALUATION_CONTEXT),
      );
      expect(model.watermarks).toEqual([]);
      expect(model.attachmentManifest.map((item) => item.id)).not.toContain(sourceAttachmentId);
      const indexedAttachmentIds = model.sections.flatMap((section) =>
        section.blocks.flatMap((block) =>
          block.type === "attachmentIndex" ? block.attachmentIds : [],
        ),
      );
      expect(indexedAttachmentIds).not.toContain(sourceAttachmentId);
    }
  });

  it("compiles a review copy when a qualification attachment is excluded from submission", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const base = fixture("bid-government-goods") as Record<string, unknown>;
    const qualifications = base.qualifications as Array<Record<string, unknown>>;
    const qualificationAttachmentId = qualifications[0]?.attachmentId as string;
    const attachments = clone(base.attachments as Array<Record<string, unknown>>);
    const attachmentIndex = attachments.findIndex((item) => item.id === qualificationAttachmentId);
    attachments[attachmentIndex] = {
      ...attachments[attachmentIndex],
      includedInSubmission: false,
    };

    const draft = { ...base, attachments };
    expect(
      registration.preflight(draft, READY_EVALUATION_CONTEXT).map((finding) => finding.code),
    ).toContain("BID_EVIDENCE_ATTACHMENT_NOT_READY");
    const model = DocumentModelV2Schema.parse(
      registration.compile(draft, READY_EVALUATION_CONTEXT),
    );
    expect(model.watermarks[0]?.id).toBe("review-copy");
    expect(model.attachmentManifest.map((item) => item.id)).not.toContain(
      qualificationAttachmentId,
    );
    const qualificationIndex = model.sections
      .find((section) => section.id === "qualification-index")
      ?.blocks.find((block) => block.id === "qualification-attachment-index");
    expect(qualificationIndex).toMatchObject({ type: "attachmentIndex", attachmentIds: [] });
  });
});
