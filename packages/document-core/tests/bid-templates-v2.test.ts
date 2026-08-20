import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentModelV2Schema } from "../src/v2/index.js";
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

describe("bid.government.goods.v1", () => {
  it("registers its source basis and compiles a verified fixture in stable order", () => {
    const registration = V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const draft = registration.parseDraft(fixture("bid-government-goods"));
    const model = DocumentModelV2Schema.parse(registration.compile(draft));

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
    const model = DocumentModelV2Schema.parse(registration.compile(draft));

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
    const model = DocumentModelV2Schema.parse(registration.compile(draft));

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
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
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
    const model = DocumentModelV2Schema.parse(registration.compile(draft));
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
