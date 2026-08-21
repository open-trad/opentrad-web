import { CAPABILITIES } from "@opentrad/contracts";
import { degrees, PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchPdfConversion,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  PDF_TRANSFORM_LIMITS,
  type PdfPagePlan,
  reorderPdf,
  splitPdf,
} from "../src/pdf/transformPdf.js";
import { installLocalConversionWorker } from "../src/worker.js";

class PdfWorkerScope {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly posts: unknown[] = [];

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.posts.push(structuredClone(message, { transfer }));
  }

  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
}

const pdfjsMock = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  inspectPdf: vi.fn(),
  renderPdfPage: vi.fn(),
}));
const contractMockState = vi.hoisted(() => ({ missing: false }));

vi.mock("@opentrad/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@opentrad/contracts")>();
  const mocked = { ...original };
  Object.defineProperty(mocked, "CAPABILITIES", {
    enumerable: true,
    get: () => (contractMockState.missing ? [] : original.CAPABILITIES),
  });
  return mocked;
});

vi.mock("../src/pdf/pdfjs.js", () => ({
  extractPdfText: pdfjsMock.extractPdfText,
  inspectPdf: pdfjsMock.inspectPdf,
  PDF_LIMITS: {
    maxPageArea: 40_000_000,
    maxPageDimension: 14_400,
  },
  renderPdfPage: pdfjsMock.renderPdfPage,
}));

const MiB = 1024 * 1024;
const text = new TextEncoder();

async function pdf(
  pages: readonly {
    readonly height: number;
    readonly rotation?: 0 | 90 | 180 | 270;
    readonly width: number;
  }[],
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.create({ updateMetadata: false });
  for (const item of pages) {
    const page = document.addPage([item.width, item.height]);
    page.setRotation(degrees(item.rotation ?? 0));
  }
  return Uint8Array.from(
    await document.save({
      addDefaultPage: false,
      updateFieldAppearances: false,
      useObjectStreams: true,
    }),
  );
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}

function transparentPng(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOvgAADr4B6kKxwAAAABNJREFUKFNj/M+ADzDhlWUYqdIAQSwBE8U+X40AAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

beforeEach(() => {
  pdfjsMock.extractPdfText.mockReset();
  pdfjsMock.extractPdfText.mockResolvedValue({ pageCount: 1, pages: [], text: "local text" });
  pdfjsMock.renderPdfPage.mockReset();
  pdfjsMock.renderPdfPage.mockImplementation(
    async (_bytes: Uint8Array, options: { readonly format?: "jpg" | "png" }) =>
      options.format === "jpg"
        ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  pdfjsMock.inspectPdf.mockReset();
  pdfjsMock.inspectPdf.mockImplementation(async (bytes: Uint8Array) => {
    const raw = new TextDecoder("latin1").decode(bytes);
    if (!raw.startsWith("%PDF-") || !raw.includes("startxref") || !raw.includes("%%EOF")) {
      throw new Error("PDF_FORMAT_INVALID");
    }
    if (
      raw.includes("/OpenAction") ||
      raw.includes("/JavaScript") ||
      raw.includes("/Launch") ||
      raw.includes("/URI")
    ) {
      throw new Error("PDF_SECURITY_VIOLATION");
    }
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    return {
      pageCount: document.getPageCount(),
      pages: document.getPages().map((page, index) => ({
        ...page.getSize(),
        pageNumber: index + 1,
        rotation: page.getRotation().angle,
      })),
    };
  });
});

describe("PDF page transforms", () => {
  it("applies an explicit multi-source page plan with reorder and rotation", async () => {
    const first = await pdf([
      { height: 300, width: 200 },
      { height: 200, rotation: 180, width: 300 },
    ]);
    const second = await pdf([{ height: 500, width: 400 }]);

    const output = await organizePdf(
      [first, second],
      [
        { page: 0, rotation: 90, source: 1 },
        { page: 1, rotation: 270, source: 0 },
        { page: 0, rotation: 0, source: 0 },
      ],
    );
    const parsed = await PDFDocument.load(output, { updateMetadata: false });

    expect(parsed.getPageCount()).toBe(3);
    expect(parsed.getPage(0).getSize()).toEqual({ height: 500, width: 400 });
    expect(parsed.getPages().map((page) => page.getRotation().angle)).toEqual([90, 270, 0]);
    expect(pdfjsMock.inspectPdf).toHaveBeenCalledTimes(2);
  });

  it("merges every source page in source order", async () => {
    const first = await pdf([
      { height: 20, width: 10 },
      { height: 40, width: 30 },
    ]);
    const second = await pdf([{ height: 60, width: 50 }]);

    const parsed = await PDFDocument.load(await mergePdfs([first, second]));

    expect(parsed.getPages().map((page) => page.getSize())).toEqual([
      { height: 20, width: 10 },
      { height: 40, width: 30 },
      { height: 60, width: 50 },
    ]);
  });

  it("splits a source into explicit non-empty page groups", async () => {
    const source = await pdf([
      { height: 20, width: 10 },
      { height: 40, width: 30 },
      { height: 60, width: 50 },
    ]);

    const outputs = await splitPdf(source, [[2, 0], [1]]);
    const parsed = await Promise.all(outputs.map((bytes) => PDFDocument.load(bytes)));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.getPages().map((page) => page.getSize())).toEqual([
      { height: 60, width: 50 },
      { height: 20, width: 10 },
    ]);
    expect(parsed[1]?.getPages().map((page) => page.getSize())).toEqual([
      { height: 40, width: 30 },
    ]);
  });

  it("reorders one PDF with explicit absolute rotations", async () => {
    const source = await pdf([
      { height: 20, rotation: 180, width: 10 },
      { height: 40, width: 30 },
    ]);

    const output = await reorderPdf(source, [
      { page: 1, rotation: 90 },
      { page: 0, rotation: 0 },
    ]);
    const parsed = await PDFDocument.load(output);

    expect(parsed.getPages().map((page) => page.getRotation().angle)).toEqual([90, 0]);
  });

  it("writes deterministic metadata and byte-identical output", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const plan = [{ page: 0, rotation: 0 as const, source: 0 }];

    const first = await organizePdf([source], plan);
    const second = await organizePdf([source], plan);
    const parsed = await PDFDocument.load(first, { updateMetadata: false });

    expect(first).toEqual(second);
    expect(parsed.getProducer()).toBe("OpenTrad local PDF tools");
    expect(parsed.getCreator()).toBe("OpenTrad local PDF tools");
    expect(parsed.getCreationDate()).toEqual(new Date(0));
    expect(parsed.getModificationDate()).toEqual(new Date(0));
  });

  it.each([
    { plan: [], sources: [new Uint8Array([1])], error: "PDF_PLAN_LIMIT" },
    { plan: [{ page: 0, rotation: 0, source: 0 }], sources: [], error: "PDF_SOURCE_LIMIT" },
    {
      plan: Array.from({ length: 201 }, () => ({ page: 0, rotation: 0, source: 0 })),
      sources: [new Uint8Array([1])],
      error: "PDF_PLAN_LIMIT",
    },
    {
      plan: [{ page: 0, rotation: 0, source: 0 }],
      sources: Array.from({ length: 21 }, () => new Uint8Array([1])),
      error: "PDF_SOURCE_LIMIT",
    },
  ])("rejects page/source limit violations with $error", async ({ error, plan, sources }) => {
    await expect(organizePdf(sources, plan as readonly PdfPagePlan[])).rejects.toThrow(error);
  });

  it("rejects invalid source, page, and rotation entries", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);

    await expect(organizePdf([source], [{ page: 0, rotation: 0, source: 1 }])).rejects.toThrow(
      "PDF_PAGE_OUT_OF_RANGE",
    );
    await expect(organizePdf([source], [{ page: 1, rotation: 0, source: 0 }])).rejects.toThrow(
      "PDF_PAGE_OUT_OF_RANGE",
    );
    await expect(
      organizePdf([source], [{ page: 0, rotation: 45 as 0, source: 0 }]),
    ).rejects.toThrow("PDF_ROTATION_INVALID");
  });

  it("rejects an oversized file and a multi-file aggregate over 50 MiB before parsing", async () => {
    await expect(
      organizePdf([new Uint8Array(25 * MiB + 1)], [{ page: 0, rotation: 0, source: 0 }]),
    ).rejects.toThrow("PDF_INPUT_TOO_LARGE");

    const part = new Uint8Array(17 * MiB);
    await expect(
      organizePdf([part, part, part], [{ page: 0, rotation: 0, source: 0 }]),
    ).rejects.toThrow("PDF_TOTAL_INPUT_TOO_LARGE");
  });

  it("rejects malformed and active-content PDFs before pdf-lib mutation", async () => {
    await expect(
      organizePdf([new Uint8Array([1, 2, 3])], [{ page: 0, rotation: 0, source: 0 }]),
    ).rejects.toThrow("PDF_FORMAT_INVALID");

    const source = await pdf([{ height: 300, width: 200 }]);
    const active = concat(source, text.encode("\n/OpenAction 7 0 R\nsecret-payload"));
    const error = await organizePdf([active], [{ page: 0, rotation: 0, source: 0 }]).catch(
      (reason: unknown) => reason as Error,
    );
    if (!(error instanceof Error)) throw new Error("expected transform rejection");
    expect(error.message).toBe("PDF_SECURITY_VIOLATION");
    expect(error.message).not.toContain("secret-payload");
  });

  it("honors an already-aborted signal with a fixed error", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const controller = new AbortController();
    controller.abort("secret-reason");

    const error = await organizePdf(
      [source],
      [{ page: 0, rotation: 0, source: 0 }],
      controller.signal,
    ).catch((reason: unknown) => reason as Error);

    if (!(error instanceof Error)) throw new Error("expected cancellation rejection");
    expect(error.message).toBe("LOCAL_CONVERSION_CANCELLED");
    expect(error.message).not.toContain("secret-reason");
  });

  it("bounds hostile reorder plan failures without invoking untrusted error text", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const order = new Array(1) as unknown as Array<{ page: number; rotation: 0 }>;
    Object.defineProperty(order, "0", {
      configurable: true,
      get() {
        throw new Error("secret-plan-getter");
      },
    });

    const error = await reorderPdf(source, order).catch((reason: unknown) => reason as Error);
    if (!(error instanceof Error)) throw new Error("expected reorder rejection");
    expect(error.message).toBe("PDF_PLAN_INVALID");
    expect(error.message).not.toContain("secret-plan-getter");
  });

  it("does not let Array prototype poisoning silently substitute the requested page", async () => {
    const source = await pdf([
      { height: 20, width: 10 },
      { height: 60, width: 50 },
    ]);
    const order = [{ page: 0, rotation: 0 as const }];
    const descriptor = Reflect.getOwnPropertyDescriptor(Array.prototype, "map");
    const intrinsicMap = Array.prototype.map;
    Object.defineProperty(Array.prototype, "map", {
      configurable: true,
      value: function poisonedMap(
        this: unknown[],
        callback: (value: unknown, index: number, input: unknown[]) => unknown,
      ) {
        if (this === order) return [{ page: 1, rotation: 0, source: 0 }];
        return Reflect.apply(intrinsicMap, this, [callback]);
      },
      writable: true,
    });
    let pending: Promise<Uint8Array>;
    try {
      pending = reorderPdf(source, order);
    } finally {
      if (descriptor) Object.defineProperty(Array.prototype, "map", descriptor);
    }

    const parsed = await PDFDocument.load(await pending);
    expect(parsed.getPage(0).getSize()).toEqual({ height: 20, width: 10 });
  });
});

describe("images to PDF", () => {
  it("creates one safely sized PDF page per inspected image", async () => {
    const image = transparentPng();
    const output = await imagesToPdf([
      { bytes: image, format: "png" },
      { bytes: image, format: "png" },
    ]);
    const parsed = await PDFDocument.load(output, { updateMetadata: false });

    expect(parsed.getPageCount()).toBe(2);
    expect(parsed.getPages().map((page) => page.getSize())).toEqual([
      { height: 10, width: 10 },
      { height: 10, width: 10 },
    ]);
    expect(parsed.getProducer()).toBe("OpenTrad local PDF tools");
  });

  it("produces deterministic image PDFs", async () => {
    const source = [{ bytes: transparentPng(), format: "png" as const }];
    expect(await imagesToPdf(source)).toEqual(await imagesToPdf(source));
  });

  it("rejects empty, excessive, oversized, and malformed image inputs", async () => {
    await expect(imagesToPdf([])).rejects.toThrow("PDF_IMAGE_LIMIT");
    await expect(
      imagesToPdf(
        Array.from({ length: 81 }, () => ({ bytes: new Uint8Array([1]), format: "png" as const })),
      ),
    ).rejects.toThrow("PDF_IMAGE_LIMIT");
    await expect(
      imagesToPdf([{ bytes: new Uint8Array(25 * MiB + 1), format: "png" }]),
    ).rejects.toThrow("PDF_INPUT_TOO_LARGE");
    await expect(
      imagesToPdf([{ bytes: new Uint8Array([1, 2, 3]), format: "png" }]),
    ).rejects.toThrow("IMAGE_FORMAT_INVALID");
  });
});

describe("transform limits", () => {
  it("exposes immutable authoritative aggregate limits", () => {
    const pdfOrganize = CAPABILITIES.find((capability) => capability.id === "pdf.organize");
    const imagesToPdfCapability = CAPABILITIES.find(
      (capability) => capability.id === "images.to.pdf",
    );
    expect(PDF_TRANSFORM_LIMITS).toEqual({
      maxImageSources: imagesToPdfCapability?.limits.maxFiles,
      maxInputBytes: pdfOrganize?.limits.maxInputBytes,
      maxOutputBytes: pdfOrganize?.limits.maxTotalBytes,
      maxPdfSources: pdfOrganize?.limits.maxFiles,
      maxPlanPages: pdfOrganize?.limits.maxPages,
      maxTotalBytes: pdfOrganize?.limits.maxTotalBytes,
    });
    expect(Object.getPrototypeOf(PDF_TRANSFORM_LIMITS)).toBeNull();
    expect(Object.isFrozen(PDF_TRANSFORM_LIMITS)).toBe(true);
  });

  it("fails closed at module startup when aggregate capability authority is missing", async () => {
    contractMockState.missing = true;
    vi.resetModules();
    try {
      const mockedContracts = await import("@opentrad/contracts");
      expect(mockedContracts.CAPABILITIES).toEqual([]);
      const freshTransform = "../src/pdf/transformPdf.js?authority-missing";
      await expect(import(/* @vite-ignore */ freshTransform)).rejects.toThrow(
        "PDF_CAPABILITY_INVALID",
      );
    } finally {
      contractMockState.missing = false;
      vi.resetModules();
    }
  });
});

describe("PDF worker dispatch", () => {
  it("extracts single-PDF text with a fixed media type", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const output = await dispatchPdfConversion({
      bytes: source,
      id: "00000000-0000-4000-8000-000000000001",
      inputFormat: "pdf",
      operation: "pdf.inspect",
      options: {},
      outputFormat: "txt",
    });

    expect(output.mediaType).toBe("text/plain");
    expect(new TextDecoder().decode(output.bytes)).toBe("local text");
    expect(pdfjsMock.extractPdfText).toHaveBeenCalledWith(source, { signal: undefined });
  });

  it("dispatches explicit aggregate PDF organization", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const output = await dispatchPdfConversion({
      files: [{ bytes: source, inputFormat: "pdf" }],
      id: "00000000-0000-4000-8000-000000000002",
      kind: "aggregate",
      operation: "pdf.organize",
      options: { pagePlan: [{ page: 0, rotation: 90, source: 0 }] },
      outputFormat: "pdf",
    });
    const parsed = await PDFDocument.load(output.bytes);

    expect(output.mediaType).toBe("application/pdf");
    expect(parsed.getPage(0).getRotation().angle).toBe(90);
  });

  it("dispatches explicit aggregate images-to-PDF", async () => {
    const output = await dispatchPdfConversion({
      files: [{ bytes: transparentPng(), inputFormat: "png" }],
      id: "00000000-0000-4000-8000-000000000003",
      kind: "aggregate",
      operation: "images.to.pdf",
      options: {},
      outputFormat: "pdf",
    });

    expect(output.mediaType).toBe("application/pdf");
    await expect(PDFDocument.load(output.bytes)).resolves.toMatchObject({});
  });

  it("runs an aggregate PDF request through the generic worker boundary", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const scope = new PdfWorkerScope();
    const dispose = installLocalConversionWorker(scope, dispatchPdfConversion);
    const id = "00000000-0000-4000-8000-000000000006";
    scope.emit({
      files: [{ bytes: source, inputFormat: "pdf" }],
      id,
      kind: "aggregate",
      operation: "pdf.organize",
      options: { pagePlan: [{ page: 0, rotation: 180, source: 0 }] },
      outputFormat: "pdf",
    });

    await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
    const response = scope.posts[0] as {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly mediaType: string;
      readonly ok: boolean;
    };
    expect(response).toMatchObject({ id, mediaType: "application/pdf", ok: true });
    const parsed = await PDFDocument.load(response.bytes);
    expect(parsed.getPage(0).getRotation().angle).toBe(180);
    dispose();
    expect(scope.listeners.size).toBe(0);
  });

  it("renders an explicit PDF page to PNG", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const output = await dispatchPdfConversion({
      bytes: source,
      id: "00000000-0000-4000-8000-000000000004",
      inputFormat: "pdf",
      operation: "pdf.inspect",
      options: { pageNumber: 2, scale: 1.5 },
      outputFormat: "png",
    });

    expect(output.mediaType).toBe("image/png");
    expect(output.bytes).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(pdfjsMock.renderPdfPage).toHaveBeenCalledWith(source, {
      format: "png",
      pageNumber: 2,
      scale: 1.5,
      signal: undefined,
    });
  });

  it("renders an explicit PDF page to quality-controlled JPEG", async () => {
    const source = await pdf([{ height: 300, width: 200 }]);
    const output = await dispatchPdfConversion({
      bytes: source,
      id: "00000000-0000-4000-8000-000000000005",
      inputFormat: "pdf",
      operation: "pdf.inspect",
      options: { pageNumber: 1, quality: 72, scale: 2 },
      outputFormat: "jpg",
    });

    expect(output.mediaType).toBe("image/jpeg");
    expect(output.bytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(pdfjsMock.renderPdfPage).toHaveBeenCalledWith(source, {
      format: "jpg",
      pageNumber: 1,
      quality: 72,
      scale: 2,
      signal: undefined,
    });
  });
});
