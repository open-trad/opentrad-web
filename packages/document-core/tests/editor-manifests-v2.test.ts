import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TemplateFieldManifestEntryV1 } from "../src/v2/common.js";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index.js";

const TEMPLATE_CASES = [
  ["quotation.service.project.v1", "quotation-service-project"],
  ["quotation.oem.custom.v1", "quotation-oem-custom"],
  ["quotation.export.bilingual.v1", "quotation-export-bilingual"],
  ["quotation.proforma.invoice.v1", "quotation-proforma-invoice"],
  ["contract.sale.domestic-b2b.v1", "contract-domestic-sale"],
  ["contract.supply.framework.v1", "contract-framework-supply"],
  ["contract.oem.processing.v1", "contract-oem-processing"],
  ["contract.service.commercial.v1", "contract-commercial-service"],
  ["contract.sale.international-bilingual.v1", "contract-international-sale"],
  ["bid.government.goods.v1", "bid-government-goods"],
  ["bid.government.services.v1", "bid-government-services"],
  ["bid.construction.works.v1", "bid-construction-works"],
  ["bid.enterprise.goods.v1", "bid-enterprise-goods"],
  ["bid.enterprise.services.v1", "bid-enterprise-services"],
] as const;

const SYSTEM_OR_COMPUTED_ROOTS = new Set([
  "attachments",
  "id",
  "templateId",
  "templateVersion",
  "updatedAt",
]);

const EXPECTED_REPEATABLE_COUNTS = new Map<string, number>([
  ["quotation.service.project.v1", 2],
  ["quotation.oem.custom.v1", 1],
  ["quotation.export.bilingual.v1", 2],
  ["quotation.proforma.invoice.v1", 2],
  ["contract.sale.domestic-b2b.v1", 4],
  ["contract.supply.framework.v1", 2],
  ["contract.oem.processing.v1", 6],
  ["contract.service.commercial.v1", 4],
  ["contract.sale.international-bilingual.v1", 3],
  ["bid.government.goods.v1", 16],
  ["bid.government.services.v1", 20],
  ["bid.construction.works.v1", 16],
  ["bid.enterprise.goods.v1", 15],
  ["bid.enterprise.services.v1", 23],
]);

type MutableRecord = Record<string, unknown>;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/v2/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

function record(value: unknown, label: string): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object at ${label}`);
  }
  return value as MutableRecord;
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (current === undefined) return undefined;
    current = record(current, path)[part];
  }
  return current;
}

function writePath(root: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = record(root, path);
  for (const part of parts.slice(0, -1)) {
    if (current[part] === undefined) current[part] = {};
    current = record(current[part], path);
  }
  const leaf = parts.at(-1);
  if (!leaf) throw new Error("Manifest paths cannot be empty");
  current[leaf] = value;
}

function deletePath(root: unknown, path: string): void {
  const parts = path.split(".");
  let current = record(root, path);
  for (const part of parts.slice(0, -1)) current = record(current[part], path);
  const leaf = parts.at(-1);
  if (!leaf) throw new Error("Manifest paths cannot be empty");
  delete current[leaf];
}

function coordinateStaticOption(candidate: unknown, path: string, option: string): void {
  if (path === "meta.effectiveMode") {
    if (option === "signature") {
      deletePath(candidate, "meta.effectiveDate");
      deletePath(candidate, "meta.effectiveCondition");
    } else if (option === "date") {
      writePath(candidate, "meta.effectiveDate", "2026-08-20");
      deletePath(candidate, "meta.effectiveCondition");
    } else {
      deletePath(candidate, "meta.effectiveDate");
      writePath(candidate, "meta.effectiveCondition", "双方完成约定审批");
    }
  }
  if (path === "generalTerms.disputeMethod") {
    if (option === "court") {
      writePath(candidate, "generalTerms.court", "有管辖权的人民法院");
      deletePath(candidate, "generalTerms.arbitrationCommission");
    } else {
      deletePath(candidate, "generalTerms.court");
      writePath(candidate, "generalTerms.arbitrationCommission", "中国国际经济贸易仲裁委员会");
    }
  }
  if (path === "rights.ipOwnership") {
    if (option === "custom") writePath(candidate, "rights.ipCustomText", "双方另行约定知识产权");
    else deletePath(candidate, "rights.ipCustomText");
  }
  if (path === "payment.method") {
    if (option === "letter-of-credit") {
      writePath(candidate, "payment.letterOfCreditTerms", {
        zhCN: "不可撤销信用证",
        enUS: "Irrevocable L/C",
      });
    } else {
      deletePath(candidate, "payment.letterOfCreditTerms");
    }
  }
}

function sourceOptionIds(draft: unknown, field: TemplateFieldManifestEntryV1): string[] {
  if (!("optionSourcePath" in field) || typeof field.optionSourcePath !== "string") return [];
  const source = readPath(draft, field.optionSourcePath);
  if (!Array.isArray(source)) throw new Error(`Missing option source ${field.optionSourcePath}`);
  const filter = "optionFilter" in field ? field.optionFilter : undefined;
  return source
    .map((value) => record(value, field.optionSourcePath))
    .filter((value) => filter === undefined || readPath(value, filter.path) === filter.equals)
    .map((value) => String(readPath(value, field.optionValuePath)));
}

function prepareDynamicCandidate(
  draft: unknown,
  field: TemplateFieldManifestEntryV1,
  optionId: string,
): unknown {
  const candidate = structuredClone(draft);
  if (field.path === "source.guaranteeRequirement.sourceRefIds") {
    writePath(candidate, "source.guaranteeRequirement", {
      required: true,
      allowedMethods: ["银行保函"],
      amountMinor: "1",
      sourceRefIds: [optionId],
    });
    return candidate;
  }
  writePath(candidate, field.path, field.valueKind === "string-list" ? [optionId] : optionId);
  return candidate;
}

function visibleType(field: { readonly valueKind: string }): "string" | "boolean" | undefined {
  if (field.valueKind === "boolean") return "boolean";
  if (["string", "localized-text", "date", "offset-datetime", "enum"].includes(field.valueKind)) {
    return "string";
  }
  return undefined;
}

describe("fourteen required editor manifests", () => {
  it("publishes typed frozen definitions and an own frozen factory for all fourteen versions", () => {
    const registrations = V2_TEMPLATE_REGISTRY.list();
    expect(registrations.map((registration) => registration.definition.id).sort()).toEqual(
      TEMPLATE_CASES.map(([templateId]) => templateId).sort(),
    );
    for (const registration of registrations) {
      expect(Object.hasOwn(registration, "createRepeatableItem")).toBe(true);
      expect(typeof registration.createRepeatableItem).toBe("function");
      expect(Object.isFrozen(registration.createRepeatableItem)).toBe(true);
      expect(Object.isFrozen(registration.definition)).toBe(true);
      for (const field of registration.definition.fieldManifest) {
        expect(field.valueKind).toBeDefined();
        expect(Object.isFrozen(field)).toBe(true);
        if ("options" in field && field.options) expect(Object.isFrozen(field.options)).toBe(true);
        if (field.control === "repeatable") {
          expect(Object.isFrozen(field.item)).toBe(true);
          if (field.item.kind === "object") expect(Object.isFrozen(field.item.fields)).toBe(true);
        }
      }
    }
  });

  it("pins the complete growable and fixed-cardinality repeatable inventory", () => {
    let total = 0;
    const fixed: string[] = [];
    for (const [templateId] of TEMPLATE_CASES) {
      const repeatables = registrationFields(templateId).filter(
        (field) => field.control === "repeatable",
      );
      expect(repeatables.length, templateId).toBe(EXPECTED_REPEATABLE_COUNTS.get(templateId));
      total += repeatables.length;
      for (const field of repeatables) {
        expect(field.minItems, `${templateId}:${field.path}`).toBeLessThanOrEqual(field.maxItems);
        if (field.minItems === field.maxItems) fixed.push(`${templateId}:${field.path}`);
      }
    }
    expect(total).toBe(116);
    expect(fixed.sort()).toEqual(
      [
        "contract.oem.processing.v1:signers",
        "contract.sale.domestic-b2b.v1:signers",
        "contract.sale.international-bilingual.v1:signers",
        "contract.service.commercial.v1:signers",
        "contract.supply.framework.v1:signers",
      ].sort(),
    );
  });

  for (const [templateId, fixtureName] of TEMPLATE_CASES) {
    it(`${templateId} keeps every authored root and create-draft parent reachable`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const fixtureDraft = registration.parseDraft(fixture(fixtureName));
      const created = registration.parseDraft(
        registration.createDraft({ id: "editor-created", now: "2026-08-20T00:00:00.000Z" }),
      );
      const manifestRoots = new Set(
        registration.definition.fieldManifest.map((field) => field.path.split(".")[0]),
      );
      for (const root of Object.keys(record(fixtureDraft, templateId))) {
        if (!SYSTEM_OR_COMPUTED_ROOTS.has(root)) expect(manifestRoots.has(root), root).toBe(true);
      }
      for (const field of registration.definition.fieldManifest) {
        const parts = field.path.split(".");
        let current: unknown = created;
        for (const part of parts.slice(0, -1)) {
          if (current === undefined) break;
          current = record(current, field.path)[part];
        }
        if (current === undefined) {
          expect(field.required && field.control !== "attachment", field.path).toBe(false);
        } else {
          expect(current, field.path).not.toBeNull();
        }
      }
    });

    it(`${templateId} parses every static option and every filtered dynamic source id`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const base = registration.parseDraft(fixture(fixtureName));
      for (const field of registration.definition.fieldManifest) {
        if (field.control !== "select") continue;
        if (field.valueKind === "enum") {
          expect(field.options.length, field.path).toBeGreaterThan(0);
          for (const option of field.options) {
            const candidate = structuredClone(base);
            writePath(candidate, field.path, option.value);
            coordinateStaticOption(candidate, field.path, option.value);
            expect(
              () => registration.parseDraft(candidate),
              `${field.path}:${option.value}`,
            ).not.toThrow();
          }
          continue;
        }
        const optionIds = sourceOptionIds(base, field);
        expect(optionIds.length, field.path).toBeGreaterThan(0);
        expect(new Set(optionIds).size, field.path).toBe(optionIds.length);
        for (const optionId of optionIds) {
          expect(
            () => registration.parseDraft(prepareDynamicCandidate(base, field, optionId)),
            `${field.path}:${optionId}`,
          ).not.toThrow();
        }
      }
    });

    it(`${templateId} resolves every visible condition to an exact compatible field`, () => {
      const fields = registrationFields(templateId);
      const byPath = new Map(fields.map((field) => [field.path, field]));
      for (const field of fields) {
        if (!field.visibleWhen) continue;
        const target = byPath.get(field.visibleWhen.path);
        expect(target, field.path).toBeDefined();
        if (!target) continue;
        expect(visibleType(target), field.path).toBe(typeof field.visibleWhen.equals);
        if (target.valueKind === "enum") {
          expect(target.options.some((option) => option.value === field.visibleWhen?.equals)).toBe(
            true,
          );
        }
      }
    });
  }

  it("publishes the four reviewed editor attachment policies exactly", () => {
    const field = (templateId: string, path: string) =>
      registrationFields(templateId).find((entry) => entry.path === path);
    expect(field("contract.supply.framework.v1", "orderTemplateAttachmentId")).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id",
      cardinality: "single",
      maxItems: 1,
      descriptorPath: "attachments",
      role: "supporting",
      category: "commercial",
      includeInSubmissionDefault: false,
    });
    expect(field("contract.oem.processing.v1", "technical.drawingAttachmentIds")).toMatchObject({
      control: "attachment",
      valueKind: "attachment-id-list",
      cardinality: "multiple",
      maxItems: 100,
      descriptorPath: "attachments",
      role: "submission",
      category: "technical",
      includeInSubmissionDefault: true,
    });
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
      includeInSubmissionDefault: true,
    });
  });
});

function registrationFields(templateId: string): readonly TemplateFieldManifestEntryV1[] {
  return V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").definition.fieldManifest;
}
