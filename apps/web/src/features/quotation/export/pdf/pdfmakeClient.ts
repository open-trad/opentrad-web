import { type DocumentModel, DocumentModelSchema } from "@opentrad/document-core";
import type { TFontDictionary } from "pdfmake/interfaces";
import {
  createPdfFontSecurity as createSharedPdfFontSecurity,
  PDF_MIME,
  renderPdfDefinition,
} from "../../../documents/render/pdf/pdfmakeClient";
import { buildPdfDefinition } from "./buildPdfDefinition";

export { PDF_MIME };

export class PdfGenerationError extends Error {
  readonly code = "PDF_GENERATION_FAILED" as const;

  constructor() {
    super("PDF 文件生成失败，请检查文档内容后重试");
    this.name = "PdfGenerationError";
  }
}

export interface PdfFontSecurity {
  regularUrl: string;
  boldUrl: string;
  fonts: TFontDictionary;
  allows(url: string): boolean;
}

export function createPdfFontSecurity(options: {
  baseUrl: string;
  origin: string;
}): PdfFontSecurity {
  try {
    return createSharedPdfFontSecurity(options);
  } catch {
    throw new PdfGenerationError();
  }
}

export async function renderPdfBlob(input: DocumentModel): Promise<Blob> {
  const model = DocumentModelSchema.parse(input);
  const definition = buildPdfDefinition(model);
  try {
    return await renderPdfDefinition(definition);
  } catch {
    throw new PdfGenerationError();
  }
}
