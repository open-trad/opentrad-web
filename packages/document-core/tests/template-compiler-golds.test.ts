import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DocumentModelV2Schema,
  decideBidExport,
  preflightBidCommon,
  projectBidBaseDraft,
  type RiskFindingV2,
  V2_TEMPLATE_REGISTRY,
} from "../src/v2/index";

const READY_AS_OF = "2026-08-19T00:00:00.000Z";

const fixtureNameByTemplateId = {
  "quotation.service.project.v1": "quotation-service-project",
  "quotation.oem.custom.v1": "quotation-oem-custom",
  "quotation.export.bilingual.v1": "quotation-export-bilingual",
  "quotation.proforma.invoice.v1": "quotation-proforma-invoice",
  "contract.supply.framework.v1": "contract-framework-supply",
  "contract.oem.processing.v1": "contract-oem-processing",
  "contract.service.commercial.v1": "contract-commercial-service",
  "contract.sale.international-bilingual.v1": "contract-international-sale",
  "bid.government.goods.v1": "bid-government-goods",
  "bid.construction.works.v1": "bid-construction-works",
} as const;

type FixtureTemplateId = keyof typeof fixtureNameByTemplateId;

function fixture(templateId: FixtureTemplateId): Record<string, unknown> {
  const name = fixtureNameByTemplateId[templateId];
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as Record<string, unknown>;
}

function registration(templateId: FixtureTemplateId) {
  return V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
}

function findings(templateId: FixtureTemplateId, draft: Record<string, unknown>) {
  return registration(templateId).preflight(draft, { asOf: READY_AS_OF });
}

function findingPairs(values: readonly RiskFindingV2[]) {
  return values.map((finding) => [finding.code, finding.impact]);
}

describe("template compiler conditional golds", () => {
  it("blocks a CIF/CIP quote without a separately authored insurance arrangement", () => {
    const templateId = "quotation.export.bilingual.v1";
    const base = fixture(templateId);
    const trade = base.trade as Record<string, unknown>;
    const risky = {
      ...base,
      trade: { ...trade, incotermsRule: "CIP", insuranceArrangement: undefined },
    };

    expect(findingPairs(findings(templateId, risky))).toContainEqual([
      "INCOTERMS_CIF_CIP_INSURANCE_MISSING",
      "blockSubmission",
    ]);
    expect(DocumentModelV2Schema.parse(registration(templateId).compile(risky)).watermarks).toEqual(
      [expect.objectContaining({ id: "review-required", scope: "every-page" })],
    );
  });

  it("keeps the PFI declaration explicit and never presents it as a tax invoice", () => {
    const templateId = "quotation.proforma.invoice.v1";
    const draft = fixture(templateId);
    const model = DocumentModelV2Schema.parse(registration(templateId).compile(draft));
    const declaration = model.sections
      .find((section) => section.id === "proforma-declaration")
      ?.blocks.find((block) => block.type === "declaration");

    expect(declaration).toEqual(
      expect.objectContaining({
        id: "pi-declaration",
        title: { zhCN: "形式发票声明", enUS: "Pro Forma Declaration" },
      }),
    );
    expect(JSON.stringify(declaration)).toContain(
      "不替代税务发票、正式商业发票、付款凭证或运输单据",
    );
    expect(findings(templateId, draft).every((finding) => finding.impact === "advisory")).toBe(
      true,
    );
  });

  it("renders the framework forecast as non-binding without inventing a purchase commitment", () => {
    const templateId = "contract.supply.framework.v1";
    const draft = fixture(templateId);
    const model = DocumentModelV2Schema.parse(registration(templateId).compile(draft));

    expect(JSON.stringify(model)).toContain("预测和目录不当然构成采购义务");
    expect(findings(templateId, draft)).toEqual([]);
  });

  it("blocks inconsistent OEM tooling and missing buyer-material terms", () => {
    const templateId = "quotation.oem.custom.v1";
    const base = fixture(templateId);
    const project = base.project as Record<string, unknown>;
    const terms = base.terms as Record<string, unknown>;
    const risky = {
      ...base,
      project: { ...project, buyerSuppliedMaterials: true },
      terms: {
        ...terms,
        materialReceiptAndReturn: "",
        toolingOwnership: "",
        toolingRequired: false,
      },
    };

    expect(findingPairs(findings(templateId, risky))).toEqual(
      expect.arrayContaining([
        ["OEM_TOOLING_FLAG_INCONSISTENT", "blockSubmission"],
        ["OEM_TOOLING_OWNERSHIP_MISSING", "blockSubmission"],
        ["OEM_BUYER_MATERIAL_TERMS_MISSING", "blockSubmission"],
      ]),
    );
  });

  it("blocks a service quote that involves personal data without authored handling terms", () => {
    const templateId = "quotation.service.project.v1";
    const base = fixture(templateId);
    const risky = { ...base, dataHandling: { personalDataInvolved: true } };

    expect(findingPairs(findings(templateId, risky))).toContainEqual([
      "SERVICE_PERSONAL_DATA_TERMS_MISSING",
      "blockSubmission",
    ]);
  });

  it("blocks an undecided CISG choice and marks the contract as a review draft", () => {
    const templateId = "contract.sale.international-bilingual.v1";
    const base = fixture(templateId);
    const legal = base.legal as Record<string, unknown>;
    const risky = { ...base, legal: { ...legal, cisgChoice: "undecided" } };

    expect(findingPairs(findings(templateId, risky))).toContainEqual([
      "INTERNATIONAL_CISG_UNDECIDED",
      "blockSubmission",
    ]);
    expect(DocumentModelV2Schema.parse(registration(templateId).compile(risky)).watermarks).toEqual(
      [expect.objectContaining({ id: "review-required", scope: "every-page" })],
    );
  });

  it("keeps a bid with an incomplete source version in internal-draft mode", () => {
    const templateId = "bid.government.goods.v1";
    const base = fixture(templateId);
    const source = base.source as Record<string, unknown>;
    const draft = registration(templateId).parseDraft({
      ...base,
      source: { ...source, versionLabel: "" },
    });
    const preflight = registration(templateId).preflight(draft, { asOf: READY_AS_OF });
    const decision = decideBidExport({
      draft: projectBidBaseDraft(draft as never),
      findings: preflight,
      asOf: READY_AS_OF,
    });

    expect(decision).toMatchObject({ mode: "internal-draft", canExportSubmission: false });
    expect(decision.blockingCodes).toContain("BID_SOURCE_VERSION_INCOMPLETE");
    expect(decision.watermarks).toEqual([
      expect.objectContaining({ id: "unbound-source", scope: "every-page" }),
    ]);
  });

  it("blocks an unanswered substantial requirement and permits only a review copy", () => {
    const templateId = "bid.government.goods.v1";
    const base = fixture(templateId);
    const requirements = (base.requirements as Array<Record<string, unknown>>).map((item, index) =>
      index === 0
        ? {
            ...item,
            compliance: "unreviewed",
            responseStatus: "not-started",
            responseText: "",
            reviewStatus: "pending",
          }
        : item,
    );
    const parsed = registration(templateId).parseDraft(base);
    const draft = { ...projectBidBaseDraft(parsed as never), requirements };
    const preflight = preflightBidCommon(draft);
    const decision = decideBidExport({ draft, findings: preflight, asOf: READY_AS_OF });

    expect(findingPairs(preflight)).toEqual(
      expect.arrayContaining([
        ["BID_SUBSTANTIAL_REQUIREMENT_NOT_ACCEPTED", "blockSubmission"],
        ["BID_SUBSTANTIAL_REQUIREMENT_NONCOMPLIANT", "blockSubmission"],
      ]),
    );
    expect(decision).toMatchObject({ mode: "review-copy", canExportSubmission: false });
  });

  it("blocks missing construction personnel and equipment and permits only a review copy", () => {
    const templateId = "bid.construction.works.v1";
    const base = fixture(templateId);
    const draft = registration(templateId).parseDraft({
      ...base,
      equipmentList: [],
      keyTechnicalPersonnel: [],
    });
    const preflight = registration(templateId).preflight(draft, { asOf: READY_AS_OF });
    const decision = decideBidExport({
      draft: projectBidBaseDraft(draft as never),
      findings: preflight,
      asOf: READY_AS_OF,
    });

    expect(findingPairs(preflight)).toEqual(
      expect.arrayContaining([
        ["BID_CONSTRUCTION_PERSONNEL_MISSING", "blockSubmission"],
        ["BID_CONSTRUCTION_EQUIPMENT_MISSING", "blockSubmission"],
      ]),
    );
    expect(decision).toMatchObject({ mode: "review-copy", canExportSubmission: false });
  });
});
