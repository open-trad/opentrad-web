import type { TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

export const PDF_MIME = "application/pdf";
const FONT_DIRECTORY = "fonts/source-han-sans-cn/";

type PdfMakeApi = {
  addFonts: typeof import("pdfmake/build/pdfmake").addFonts;
  createPdf: typeof import("pdfmake/build/pdfmake").createPdf;
  setUrlAccessPolicy: typeof import("pdfmake/build/pdfmake").setUrlAccessPolicy;
};

export class PdfMakeClientError extends Error {
  readonly code = "PDFMAKE_CLIENT_FAILED" as const;

  constructor() {
    super("PDF 运行时初始化失败");
    this.name = "PdfMakeClientError";
  }
}

export interface PdfFontSecurity {
  readonly regularUrl: string;
  readonly boldUrl: string;
  readonly fonts: TFontDictionary;
  allows(url: string): boolean;
}

interface PdfMakeLocation {
  readonly baseUrl: string;
  readonly origin: string;
}

export function createPdfFontSecurity(options: PdfMakeLocation): PdfFontSecurity {
  if (options.origin === "null") throw new PdfMakeClientError();

  let origin: URL;
  let base: URL;
  try {
    origin = new URL(options.origin);
    base = new URL(options.baseUrl, `${origin.origin}/`);
  } catch {
    throw new PdfMakeClientError();
  }
  if (origin.origin !== options.origin || base.origin !== origin.origin) {
    throw new PdfMakeClientError();
  }

  const regularUrl = new URL(`${FONT_DIRECTORY}SourceHanSansCN-Regular.otf`, base).href;
  const boldUrl = new URL(`${FONT_DIRECTORY}SourceHanSansCN-Bold.otf`, base).href;
  const allowedUrls = new Set([regularUrl, boldUrl]);
  const allows = (url: string): boolean => {
    if (!allowedUrls.has(url)) return false;
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
    // pdfmake 0.3 resolves URL font descriptors in place before rendering.
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
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.addFonts === "function" &&
    typeof candidate.createPdf === "function" &&
    typeof candidate.setUrlAccessPolicy === "function"
  );
}

function defaultLocation(): PdfMakeLocation {
  if (typeof window === "undefined") throw new PdfMakeClientError();
  return { baseUrl: import.meta.env.BASE_URL, origin: window.location.origin };
}

let initializedPdfMake: Promise<PdfMakeApi> | undefined;

async function getPdfMake(): Promise<PdfMakeApi> {
  if (initializedPdfMake) return initializedPdfMake;
  const location = defaultLocation();
  const security = createPdfFontSecurity(location);
  initializedPdfMake = import("pdfmake/build/pdfmake")
    .then((loaded) => {
      const defaultExport = (loaded as unknown as { default?: unknown }).default;
      const pdfMake = isPdfMakeApi(defaultExport)
        ? defaultExport
        : isPdfMakeApi(loaded)
          ? loaded
          : undefined;
      if (!pdfMake) throw new PdfMakeClientError();
      pdfMake.setUrlAccessPolicy(security.allows);
      pdfMake.addFonts(security.fonts);
      return pdfMake;
    })
    .catch(() => {
      initializedPdfMake = undefined;
      throw new PdfMakeClientError();
    });
  return initializedPdfMake;
}

export async function renderPdfDefinition(definition: TDocumentDefinitions): Promise<Blob> {
  try {
    const pdfMake = await getPdfMake();
    const blob = await pdfMake.createPdf(definition).getBlob();
    return blob.type === PDF_MIME ? blob : blob.slice(0, blob.size, PDF_MIME);
  } catch {
    throw new PdfMakeClientError();
  }
}
