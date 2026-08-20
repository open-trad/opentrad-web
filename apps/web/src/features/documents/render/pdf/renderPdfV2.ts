import type {
  DocumentLanguageV2,
  DocumentModel,
  DocumentModelV2,
  LayoutStyleId,
} from "@opentrad/document-core";
import { buildPdfDefinitionV2 } from "./buildPdfDefinitionV2";
import { PDF_MIME, renderPdfDefinition } from "./pdfmakeClient";

export const PDF_V2_MIME = PDF_MIME;

export class PdfV2GenerationError extends Error {
  readonly code = "PDF_V2_GENERATION_FAILED" as const;

  constructor() {
    super("PDF 文件生成失败，请检查文档内容后重试");
    this.name = "PdfV2GenerationError";
  }
}

export async function renderPdfV2(
  input: DocumentModel | DocumentModelV2,
  layoutStyleId: LayoutStyleId = "modern-business.v1",
  languageView: DocumentLanguageV2 = "zh-CN",
): Promise<Blob> {
  let definition: ReturnType<typeof buildPdfDefinitionV2>;
  try {
    definition = buildPdfDefinitionV2(input, layoutStyleId, languageView);
  } catch {
    throw new PdfV2GenerationError();
  }

  try {
    return await renderPdfDefinition(definition);
  } catch {
    throw new PdfV2GenerationError();
  }
}
