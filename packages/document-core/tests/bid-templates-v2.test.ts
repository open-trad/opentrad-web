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
