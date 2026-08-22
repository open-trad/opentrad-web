import {
  type LayoutStyleId,
  type OfficialSourceKey,
  type TemplateDefinitionV2,
  v2,
} from "@opentrad/document-core";

export type TemplateCategoryLabel = "报价单" | "合同" | "标书";

export interface DocumentTemplateCard {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly category: TemplateCategoryLabel;
  readonly format: "A4";
  readonly description: string;
  readonly accent: "green" | "blue" | "copper";
  readonly editorPath: string;
  readonly basisDate: string;
  readonly languages: readonly string[];
  readonly defaultLayout: LayoutStyleId;
  readonly sourceKeys: readonly OfficialSourceKey[];
  readonly disclaimerProfile: TemplateDefinitionV2["disclaimerProfile"];
}

function freezeCard(card: DocumentTemplateCard): Readonly<DocumentTemplateCard> {
  return Object.freeze({
    ...card,
    languages: Object.freeze([...card.languages]),
    sourceKeys: Object.freeze([...card.sourceKeys]),
  });
}

const V1_STANDARD_CARD = freezeCard({
  id: "quotation.goods.standard.v1",
  version: "1.0.0",
  title: "标准货物报价单",
  category: "报价单",
  format: "A4",
  description: "适用于常规商品询报价，支持精确税额、折扣和本地导出。",
  accent: "green",
  editorPath: "/editor/standard-goods-quote",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLayout: "classic-formal.v1",
  sourceKeys: ["samr-contract-library"],
  disclaimerProfile: "quotation",
});

const CATEGORY_LABELS = {
  quotation: "报价单",
  contract: "合同",
  bid: "标书",
} as const satisfies Record<TemplateDefinitionV2["category"], TemplateCategoryLabel>;

function cardFromDefinition(definition: TemplateDefinitionV2): Readonly<DocumentTemplateCard> {
  return freezeCard({
    id: definition.id,
    version: definition.version,
    title: definition.name,
    category: CATEGORY_LABELS[definition.category],
    format: "A4",
    description: definition.summary,
    accent:
      definition.category === "bid"
        ? "copper"
        : definition.category === "contract"
          ? "blue"
          : "green",
    editorPath: `/editor/${definition.id}`,
    basisDate: definition.basisDate,
    languages: definition.languages,
    defaultLayout: definition.defaultLayout,
    sourceKeys: definition.sourceKeys,
    disclaimerProfile: definition.disclaimerProfile,
  });
}

export const templates: readonly Readonly<DocumentTemplateCard>[] = Object.freeze([
  V1_STANDARD_CARD,
  ...v2.V2_TEMPLATE_REGISTRY.list().map(({ definition }) => cardFromDefinition(definition)),
]);
