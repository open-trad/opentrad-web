import {
  type ComplianceMatrixBlockV2,
  type DocumentBlockV2,
  type DocumentLanguageV2,
  type DocumentModel,
  type DocumentModelV2,
  type TableBlockV2,
  v2,
} from "@opentrad/document-core";
import { localizedTextValue, normalizeDocumentModel } from "../normalizeModel";
import { allocateComplianceMatrixWidthsTwips, allocatePercentageWidthsTwips } from "../tableWidths";

export const A4_PORTRAIT_WIDTH_TWIPS = 11_906;
export const A4_PORTRAIT_HEIGHT_TWIPS = 16_838;

type PresentationProfileV1 = ReturnType<typeof v2.getPresentationProfile>;
type PlainBlockV2 = Exclude<DocumentBlockV2, TableBlockV2 | ComplianceMatrixBlockV2>;

export type DocxPlanBlockV2 =
  | PlainBlockV2
  | (TableBlockV2 & {
      readonly columnWidthsTwips: readonly number[];
      readonly cantSplitRows: boolean;
    })
  | (ComplianceMatrixBlockV2 & {
      readonly columnWidthsTwips: readonly number[];
      readonly repeatHeader: true;
      readonly cantSplitRows: true;
    });

export interface DocxPlanSectionV2 {
  readonly id: string;
  readonly orientation: "portrait" | "landscape";
  readonly widthTwips: number;
  readonly heightTwips: number;
  readonly marginsTwips: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly blocks: readonly DocxPlanBlockV2[];
}

export interface DocxWatermarkPlanV2 {
  readonly id: string;
  readonly text: string;
  readonly scope: "every-page" | "first-page";
}

export interface DocxPlanV2 {
  readonly title: string;
  readonly languageView: DocumentLanguageV2;
  readonly profile: PresentationProfileV1;
  readonly updateFields: true;
  readonly footer: { readonly text: string; readonly pageNumbers: true };
  readonly sections: readonly DocxPlanSectionV2[];
  readonly blockKinds: readonly DocumentBlockV2["type"][];
  readonly watermarks: readonly DocxWatermarkPlanV2[];
  readonly disclaimers: DocumentModelV2["disclaimers"];
  readonly attachmentManifest: DocumentModelV2["attachmentManifest"];
}

function millimetresToTwips(value: number): number {
  return Math.round((value * 1_440) / 25.4);
}

function planBlock(block: DocumentBlockV2, availableWidthTwips: number): DocxPlanBlockV2 {
  if (block.type === "table") {
    return Object.freeze({
      ...block,
      columnWidthsTwips: allocatePercentageWidthsTwips(
        block.columns.map((column) => column.width),
        availableWidthTwips,
      ),
      cantSplitRows: !block.pagePolicy.allowRowSplit,
    });
  }
  if (block.type === "complianceMatrix") {
    return Object.freeze({
      ...block,
      columnWidthsTwips: allocateComplianceMatrixWidthsTwips(
        block.columns.map((column) => column.width),
        availableWidthTwips,
      ),
      repeatHeader: true as const,
      cantSplitRows: true as const,
    });
  }
  return block;
}

function footerText(languageView: DocumentLanguageV2): string {
  if (languageView === "zh-CN") return "OpenTrad 开源商贸 · 本地生成";
  if (languageView === "en-US") return "OpenTrad · Generated locally";
  return "OpenTrad 开源商贸 · 本地生成 / OpenTrad · Generated locally";
}

export function buildDocxPlanV2(
  input: DocumentModel | DocumentModelV2,
  layoutStyleId: string = "modern-business.v1",
  languageView: DocumentLanguageV2 = "zh-CN",
): DocxPlanV2 {
  const model = normalizeDocumentModel(input);
  const validatedLanguage = v2.DocumentLanguageV2Schema.parse(languageView);
  const profile = v2.getPresentationProfile(layoutStyleId);
  const marginsTwips = Object.freeze({
    top: millimetresToTwips(model.pageDefaults.marginsMm.top),
    right: millimetresToTwips(model.pageDefaults.marginsMm.right),
    bottom: millimetresToTwips(model.pageDefaults.marginsMm.bottom),
    left: millimetresToTwips(model.pageDefaults.marginsMm.left),
  });
  const sections = model.sections.map((section): DocxPlanSectionV2 => {
    const orientation = section.page?.orientation ?? model.pageDefaults.orientation;
    const widthTwips =
      orientation === "landscape" ? A4_PORTRAIT_HEIGHT_TWIPS : A4_PORTRAIT_WIDTH_TWIPS;
    const heightTwips =
      orientation === "landscape" ? A4_PORTRAIT_WIDTH_TWIPS : A4_PORTRAIT_HEIGHT_TWIPS;
    const availableWidthTwips = widthTwips - marginsTwips.left - marginsTwips.right;
    const blocks = section.blocks.map((block) => planBlock(block, availableWidthTwips));
    return Object.freeze({
      id: section.id,
      orientation,
      widthTwips,
      heightTwips,
      marginsTwips,
      blocks: Object.freeze(blocks),
    });
  });
  const watermarks = model.watermarks.map((watermark) =>
    Object.freeze({
      id: watermark.id,
      text: localizedTextValue(watermark.text, validatedLanguage),
      scope: watermark.scope,
    }),
  );
  return Object.freeze({
    title: localizedTextValue(model.title, validatedLanguage),
    languageView: validatedLanguage,
    profile,
    updateFields: true as const,
    footer: Object.freeze({ text: footerText(validatedLanguage), pageNumbers: true as const }),
    sections: Object.freeze(sections),
    blockKinds: Object.freeze(
      sections.flatMap((section) => section.blocks.map((block) => block.type)),
    ),
    watermarks: Object.freeze(watermarks),
    disclaimers: model.disclaimers,
    attachmentManifest: model.attachmentManifest,
  });
}
