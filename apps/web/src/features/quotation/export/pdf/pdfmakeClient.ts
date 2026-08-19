import { type DocumentModel, DocumentModelSchema } from "@opentrad/document-core";
import type { TFontDictionary } from "pdfmake/interfaces";
import { buildPdfDefinition } from "./buildPdfDefinition";

export const PDF_MIME = "application/pdf";
const FONT_DIRECTORY = "fonts/source-han-sans-cn/";

type PdfMakeApi = {
  addFonts: typeof import("pdfmake/build/pdfmake").addFonts;
  createPdf: typeof import("pdfmake/build/pdfmake").createPdf;
  setUrlAccessPolicy: typeof import("pdfmake/build/pdfmake").setUrlAccessPolicy;
};

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
  if (options.origin === "null") {
    throw new PdfGenerationError();
  }
  let origin: URL;
  let base: URL;
  try {
    origin = new URL(options.origin);
    base = new URL(options.baseUrl, `${origin.origin}/`);
  } catch {
    throw new PdfGenerationError();
  }
  if (origin.origin !== options.origin || base.origin !== origin.origin) {
    throw new PdfGenerationError();
  }

  const regularUrl = new URL(`${FONT_DIRECTORY}SourceHanSansCN-Regular.otf`, base).href;
  const boldUrl = new URL(`${FONT_DIRECTORY}SourceHanSansCN-Bold.otf`, base).href;
  const allowedUrls = new Set([regularUrl, boldUrl]);
  const allows = (url: string): boolean => {
    if (!allowedUrls.has(url)) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return (
        parsed.origin === origin.origin &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.search === "" &&
        parsed.hash === ""
      );
    } catch {
      return false;
    }
  };

  return {
    regularUrl,
    boldUrl,
    allows,
    fonts: {
      SourceHanSansCN: {
        normal: regularUrl,
        italics: regularUrl,
        bold: boldUrl,
        bolditalics: boldUrl,
      },
    },
  };
}

function isPdfMakeApi(value: unknown): value is PdfMakeApi {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.addFonts === "function" &&
    typeof candidate.createPdf === "function" &&
    typeof candidate.setUrlAccessPolicy === "function"
  );
}

let initializedPdfMake: Promise<PdfMakeApi> | undefined;

async function getPdfMake(): Promise<PdfMakeApi> {
  if (!initializedPdfMake) {
    initializedPdfMake = import("pdfmake/build/pdfmake")
      .then((loaded) => {
        const defaultExport = (loaded as unknown as { default?: unknown }).default;
        const pdfMake = isPdfMakeApi(defaultExport)
          ? defaultExport
          : isPdfMakeApi(loaded)
            ? loaded
            : undefined;
        if (!pdfMake) {
          throw new PdfGenerationError();
        }
        const security = createPdfFontSecurity({
          baseUrl: import.meta.env.BASE_URL,
          origin: window.location.origin,
        });
        pdfMake.setUrlAccessPolicy(security.allows);
        pdfMake.addFonts(security.fonts);
        return pdfMake;
      })
      .catch((error: unknown) => {
        initializedPdfMake = undefined;
        if (error instanceof PdfGenerationError) {
          throw error;
        }
        throw new PdfGenerationError();
      });
  }
  return initializedPdfMake;
}

export async function renderPdfBlob(input: DocumentModel): Promise<Blob> {
  const model = DocumentModelSchema.parse(input);
  const definition = buildPdfDefinition(model);
  try {
    const pdfMake = await getPdfMake();
    const blob = await pdfMake.createPdf(definition).getBlob();
    return blob.type === PDF_MIME ? blob : blob.slice(0, blob.size, PDF_MIME);
  } catch {
    throw new PdfGenerationError();
  }
}
