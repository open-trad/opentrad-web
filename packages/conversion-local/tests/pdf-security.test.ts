import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfjsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationMode: { DISABLE: 0 },
  GlobalWorkerOptions: pdfjsMock.GlobalWorkerOptions,
  getDocument: pdfjsMock.getDocument,
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: "/assets/pdf.worker.min-local.mjs",
}));

import {
  extractPdfText,
  inspectPdf,
  loadLocalPdf,
  PDF_LIMITS,
  PDFJS_DOCUMENT_OPTIONS,
  PDFJS_VIEWER_OPTIONS,
  renderPdfPage,
} from "../src/pdf/pdfjs.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPage(overrides: Record<string, unknown> = {}) {
  const renderTask = {
    cancel: vi.fn(),
    promise: Promise.resolve(),
  };
  return {
    cleanup: vi.fn(() => true),
    getAnnotations: vi.fn(async () => []),
    getJSActions: vi.fn(async () => null),
    getTextContent: vi.fn(async () => ({ items: [{ str: "OpenTrad" }], styles: {} })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      height: 300 * scale,
      rotation: 0,
      width: 200 * scale,
    })),
    getXfa: vi.fn(async () => null),
    render: vi.fn(() => renderTask),
    rotate: 0,
    view: [0, 0, 200, 300],
    ...overrides,
  };
}

function createDocument(overrides: Record<string, unknown> = {}, page = createPage()) {
  return {
    allXfaHtml: null,
    destroy: vi.fn(async () => undefined),
    getAttachments: vi.fn(async () => null),
    getJSActions: vi.fn(async () => null),
    getOpenAction: vi.fn(async () => null),
    getOutline: vi.fn(async () => null),
    getPage: vi.fn(async () => page),
    isPureXfa: false,
    numPages: 1,
    ...overrides,
  };
}

function installDocument(document = createDocument()) {
  const task = {
    destroy: vi.fn(async () => undefined),
    onPassword: undefined as undefined | (() => void),
    promise: Promise.resolve(document),
  };
  pdfjsMock.getDocument.mockReturnValue(task);
  return { document, task };
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function lastIndexOf(source: Uint8Array, needle: Uint8Array): number {
  for (let offset = source.byteLength - needle.byteLength; offset >= 0; offset -= 1) {
    let matches = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (source[offset + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset;
  }
  return -1;
}

const utf8 = new TextEncoder();

function insertBeforeStartXref(source: Uint8Array, value: string): Uint8Array<ArrayBuffer> {
  const marker = utf8.encode("startxref");
  const offset = lastIndexOf(source, marker);
  if (offset < 0) throw new Error("fixture has no startxref");
  return concat([source.slice(0, offset), utf8.encode(`\n${value}\n`), source.slice(offset)]);
}

let minimalPdf: Uint8Array<ArrayBuffer>;

beforeEach(async () => {
  pdfjsMock.getDocument.mockReset();
  const document = await PDFDocument.create();
  document.addPage([200, 300]);
  minimalPdf = new Uint8Array(await document.save());
  installDocument();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PDF.js security configuration", () => {
  it("pins frozen null-prototype document and viewer options", () => {
    expect(PDFJS_DOCUMENT_OPTIONS).toEqual({
      isEvalSupported: false,
      useWorkerFetch: false,
      stopEvent: true,
    });
    expect(PDFJS_VIEWER_OPTIONS).toEqual({
      enableScripting: false,
      disablePreferences: true,
    });
    expect(Object.getPrototypeOf(PDFJS_DOCUMENT_OPTIONS)).toBeNull();
    expect(Object.getPrototypeOf(PDFJS_VIEWER_OPTIONS)).toBeNull();
    expect(Object.isFrozen(PDFJS_DOCUMENT_OPTIONS)).toBe(true);
    expect(Object.isFrozen(PDFJS_VIEWER_OPTIONS)).toBe(true);
  });

  it("uses only the statically bundled local PDF.js worker asset in browsers", async () => {
    vi.stubGlobal("window", {});
    const handle = await loadLocalPdf(minimalPdf);
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker.min-local.mjs");
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).not.toMatch(/^(?:https?:|data:|blob:|\/\/)/iu);
    await handle.destroy();
  });

  it("restores the pinned worker before every load after hostile mutation", async () => {
    pdfjsMock.GlobalWorkerOptions.workerSrc = "https://example.com/private-worker.js";
    const handle = await loadLocalPdf(minimalPdf);
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe("./pdf.worker.mjs");
    await handle.destroy();
  });
});

describe("local PDF admission", () => {
  it("publishes frozen null-prototype limits aligned with pdf.inspect", () => {
    expect(Object.isFrozen(PDF_LIMITS)).toBe(true);
    expect(Object.getPrototypeOf(PDF_LIMITS)).toBeNull();
    expect(PDF_LIMITS.maxInputBytes).toBe(25 * 1024 * 1024);
    expect(PDF_LIMITS.maxPages).toBe(80);
    expect(PDF_LIMITS.timeoutMs).toBeGreaterThan(0);
  });

  it("accepts a real minimal pdf-lib PDF using only a defensive data copy", async () => {
    const originalFirstByte = minimalPdf[0];
    const handle = await loadLocalPdf(minimalPdf);
    const options = pdfjsMock.getDocument.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(handle.pageCount).toBe(1);
    expect(options.data).toBeInstanceOf(Uint8Array);
    expect(options.data).not.toBe(minimalPdf);
    expect(options).toMatchObject({
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      isEvalSupported: false,
      stopAtErrors: true,
      useWorkerFetch: false,
      useWasm: false,
      verbosity: 0,
    });
    expect(options).not.toHaveProperty("url");
    expect(options).not.toHaveProperty("cMapUrl");
    expect(options).not.toHaveProperty("standardFontDataUrl");
    expect(options).not.toHaveProperty("wasmUrl");
    minimalPdf[0] = 0;
    expect((options.data as Uint8Array)[0]).toBe(originalFirstByte);

    await handle.destroy();
  });

  it("accepts a fixed ArrayBuffer and rejects non-exact or resizable byte containers", async () => {
    const buffer = minimalPdf.slice().buffer;
    const handle = await loadLocalPdf(buffer);
    await handle.destroy();

    await expect(loadLocalPdf(new Uint8Array(minimalPdf.buffer, 1))).rejects.toThrow(
      "PDF_INPUT_INVALID",
    );
    const hostile = new Proxy(minimalPdf, {
      getPrototypeOf() {
        throw new Error("private.pdf");
      },
    });
    await expect(loadLocalPdf(hostile as Uint8Array)).rejects.toThrow("PDF_INPUT_INVALID");
    await expect(loadLocalPdf(hostile as Uint8Array)).rejects.not.toThrow("private.pdf");

    if (typeof SharedArrayBuffer !== "undefined") {
      await expect(
        loadLocalPdf(new SharedArrayBuffer(8) as unknown as ArrayBuffer),
      ).rejects.toThrow("PDF_INPUT_INVALID");
    }
    if (Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")) {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        byteLength: number,
        options: { maxByteLength: number },
      ) => ArrayBuffer;
      const resizable = new ResizableArrayBuffer(minimalPdf.byteLength, {
        maxByteLength: minimalPdf.byteLength + 1,
      });
      new Uint8Array(resizable).set(minimalPdf);
      await expect(loadLocalPdf(resizable)).rejects.toThrow("PDF_INPUT_INVALID");
    }
  });

  it("rejects unknown and accessor-backed API options without invoking accessors", async () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "signal", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return new AbortController().signal;
      },
    });
    const renderAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(renderAccessor, "pageNumber", { enumerable: true, value: 1 });
    Object.defineProperty(renderAccessor, "signal", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return new AbortController().signal;
      },
    });
    for (const invoke of [
      () => loadLocalPdf(minimalPdf, accessor),
      () => inspectPdf(minimalPdf, { privateFilename: "private.pdf" } as never),
      () => extractPdfText(minimalPdf, { pages: [1], privateText: true } as never),
      () => renderPdfPage(minimalPdf, renderAccessor as never),
    ]) {
      await expect(invoke()).rejects.toThrow("PDF_OPTIONS_INVALID");
    }
    expect(getterCalls).toBe(0);
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it("rejects size, magic, version, startxref, EOF, and object-token violations before PDF.js", async () => {
    const invalidVersion = minimalPdf.slice();
    invalidVersion[7] = "9".charCodeAt(0);
    const missingEof = minimalPdf.slice(0, minimalPdf.byteLength - 6);
    const missingStartXref = minimalPdf.slice();
    const startXref = lastIndexOf(missingStartXref, utf8.encode("startxref"));
    missingStartXref.fill(0x20, startXref, startXref + "startxref".length);
    const tooManyObjects = insertBeforeStartXref(
      minimalPdf,
      "1 0 obj\nendobj\n".repeat(PDF_LIMITS.maxObjectTokens + 1),
    );

    await expect(loadLocalPdf(new Uint8Array(PDF_LIMITS.maxInputBytes + 1))).rejects.toThrow(
      "PDF_INPUT_TOO_LARGE",
    );
    await expect(loadLocalPdf(utf8.encode("not a pdf"))).rejects.toThrow("PDF_FORMAT_INVALID");
    await expect(loadLocalPdf(invalidVersion)).rejects.toThrow("PDF_FORMAT_INVALID");
    await expect(loadLocalPdf(missingEof)).rejects.toThrow("PDF_FORMAT_INVALID");
    await expect(loadLocalPdf(missingStartXref)).rejects.toThrow("PDF_FORMAT_INVALID");
    await expect(loadLocalPdf(tooManyObjects)).rejects.toThrow("PDF_OBJECT_LIMIT");
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["encryption", "/Encrypt 9 0 R", "PDF_ENCRYPTED"],
    ["embedded file", "/Type /EmbeddedFile", "PDF_SECURITY_VIOLATION"],
    ["attachment name tree", "/EmbeddedFiles 8 0 R", "PDF_SECURITY_VIOLATION"],
    ["JavaScript", "/S /JavaScript /JS (alert)", "PDF_SECURITY_VIOLATION"],
    ["open action", "/OpenAction 8 0 R", "PDF_SECURITY_VIOLATION"],
    ["XFA", "/XFA 8 0 R", "PDF_SECURITY_VIOLATION"],
    ["launch action", "/S /Launch /F (tool)", "PDF_SECURITY_VIOLATION"],
    ["URI action", "/S /URI /URI (https://example.com)", "PDF_SECURITY_VIOLATION"],
    ["remote URL", "(https://example.com/private)", "PDF_SECURITY_VIOLATION"],
  ])("rejects raw %s syntax before PDF.js", async (_label, token, code) => {
    await expect(loadLocalPdf(insertBeforeStartXref(minimalPdf, token))).rejects.toThrow(code);
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it("rejects password callbacks and redacts PDF.js failure details", async () => {
    const never = deferred<ReturnType<typeof createDocument>>();
    const passwordTask = {
      destroy: vi.fn(async () => undefined),
      onPassword: undefined as undefined | (() => void),
      promise: never.promise,
    };
    pdfjsMock.getDocument.mockImplementation(() => {
      queueMicrotask(() => passwordTask.onPassword?.());
      return passwordTask;
    });
    await expect(loadLocalPdf(minimalPdf)).rejects.toThrow("PDF_ENCRYPTED");
    expect(passwordTask.destroy).toHaveBeenCalled();

    pdfjsMock.getDocument.mockImplementation(() => {
      throw new Error("customer-contract.pdf contents");
    });
    const failure = await loadLocalPdf(minimalPdf).catch((error: unknown) => error as Error);
    expect((failure as Error).message).toBe("PDF_LOAD_FAILED");
    expect((failure as Error).message).not.toContain("customer-contract");
    expect(failure).not.toHaveProperty("cause");
  });

  it("cancels before and during load, destroys late documents, and enforces a fixed timeout", async () => {
    const before = new AbortController();
    before.abort();
    await expect(loadLocalPdf(minimalPdf, { signal: before.signal })).rejects.toThrow(
      "LOCAL_CONVERSION_CANCELLED",
    );
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();

    const loading = deferred<ReturnType<typeof createDocument>>();
    const lateDocument = createDocument();
    const task = {
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
      promise: loading.promise,
    };
    pdfjsMock.getDocument.mockReturnValue(task);
    const controller = new AbortController();
    const pending = loadLocalPdf(minimalPdf, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    loading.resolve(lateDocument);
    await vi.waitFor(() => expect(lateDocument.destroy).toHaveBeenCalled());
    expect(task.destroy).toHaveBeenCalled();

    const timedLoading = deferred<ReturnType<typeof createDocument>>();
    const timedTask = {
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
      promise: timedLoading.promise,
    };
    pdfjsMock.getDocument.mockReturnValue(timedTask);
    const timed = loadLocalPdf(minimalPdf, { timeoutMs: 10 });
    await expect(timed).rejects.toThrow("PDF_TIMEOUT");
    expect(timedTask.destroy).toHaveBeenCalled();
  });
});

describe("PDF document graph and page inspection", () => {
  it("inspects bounded pages and cleans every page", async () => {
    const first = createPage();
    const second = createPage({
      rotate: 90,
      view: [0, 0, 300, 200],
      getViewport: vi.fn(() => ({ height: 200, rotation: 90, width: 300 })),
    });
    const document = createDocument({
      getPage: vi.fn(async (pageNumber: number) => (pageNumber === 1 ? first : second)),
      numPages: 2,
    });
    const { task } = installDocument(document);

    const result = await inspectPdf(minimalPdf);
    expect(result).toEqual({
      pageCount: 2,
      pages: [
        { height: 300, pageNumber: 1, rotation: 0, width: 200 },
        { height: 200, pageNumber: 2, rotation: 90, width: 300 },
      ],
    });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(first.cleanup).toHaveBeenCalled();
    expect(second.cleanup).toHaveBeenCalled();
    expect(task.destroy).toHaveBeenCalled();
  });

  it("rejects excessive pages, XFA, attachments, scripts, open actions, and external outlines", async () => {
    const cases = [
      createDocument({ numPages: PDF_LIMITS.maxPages + 1 }),
      createDocument({ isPureXfa: true }),
      createDocument({ allXfaHtml: Object.create(null) }),
      createDocument({ getAttachments: vi.fn(async () => new Map([["x", {}]])) }),
      createDocument({ getJSActions: vi.fn(async () => ({ OpenAction: ["alert(1)"] })) }),
      createDocument({ getOpenAction: vi.fn(async () => new Map([["action", "Print"]])) }),
      createDocument({
        getOutline: vi.fn(async () => [
          {
            bold: false,
            color: new Uint8ClampedArray([0, 0, 0]),
            dest: null,
            italic: false,
            items: [],
            title: "external",
            url: "https://example.com",
          },
        ]),
      }),
    ];
    for (const document of cases) {
      installDocument(document);
      await expect(inspectPdf(minimalPdf)).rejects.toThrow(
        document.numPages === PDF_LIMITS.maxPages + 1 ? "PDF_PAGE_LIMIT" : "PDF_SECURITY_VIOLATION",
      );
    }
  });

  it("rejects page scripts, XFA, action annotations, and external annotation URLs", async () => {
    const pages = [
      createPage({ getJSActions: vi.fn(async () => ({ MouseUp: ["alert(1)"] })) }),
      createPage({ getXfa: vi.fn(async () => ({ name: "xfa" })) }),
      createPage({ getAnnotations: vi.fn(async () => [{ action: "Launch" }]) }),
      createPage({
        getAnnotations: vi.fn(async () => [{ subtype: "Link", url: "https://example.com" }]),
      }),
    ];
    for (const page of pages) {
      installDocument(createDocument({}, page));
      await expect(inspectPdf(minimalPdf)).rejects.toThrow("PDF_SECURITY_VIOLATION");
      expect(page.cleanup).toHaveBeenCalled();
    }
  });

  it("does not dispatch graph keys through a poisoned String prototype", async () => {
    const descriptor = Reflect.getOwnPropertyDescriptor(String.prototype, "toLowerCase");
    const outline = new Proxy(
      { title: "external", url: "https://example.com" },
      {
        getPrototypeOf(target) {
          Object.defineProperty(String.prototype, "toLowerCase", {
            configurable: true,
            value: () => "title",
            writable: true,
          });
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    installDocument(createDocument({ getOutline: vi.fn(async () => [outline]) }));
    try {
      await expect(inspectPdf(minimalPdf)).rejects.toThrow("PDF_SECURITY_VIOLATION");
    } finally {
      if (descriptor) Object.defineProperty(String.prototype, "toLowerCase", descriptor);
    }
  });

  it("rejects invalid MediaBox/CropBox views, viewport dimensions, and hostile accessors", async () => {
    const hostilePage = createPage();
    Object.defineProperty(hostilePage, "view", {
      get() {
        throw new Error("secret-box");
      },
    });
    const pages = [
      createPage({ view: [0, 0, Number.POSITIVE_INFINITY, 300] }),
      createPage({ view: [0, 0, 0, 300] }),
      createPage({ view: [0, 0, PDF_LIMITS.maxPageDimension + 1, 1] }),
      createPage({
        getViewport: vi.fn(() => ({ height: 300, rotation: 0, width: Number.NaN })),
      }),
      hostilePage,
    ];
    for (const page of pages) {
      installDocument(createDocument({}, page));
      const failure = await inspectPdf(minimalPdf).catch((error: unknown) => error as Error);
      expect(["PDF_DIMENSION_LIMIT", "PDF_SECURITY_VIOLATION"]).toContain(
        (failure as Error).message,
      );
      expect((failure as Error).message).not.toContain("secret-box");
    }
  });

  it("times out a stalled post-load graph check and destroys the document", async () => {
    const stalled = deferred<unknown>();
    const { task } = installDocument(
      createDocument({ getAttachments: vi.fn(() => stalled.promise) }),
    );
    const pending = inspectPdf(minimalPdf, { timeoutMs: 10 }).then(
      () => "resolved",
      (error: unknown) => (error as Error).message,
    );
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("still-pending"), 100)),
    ]);
    expect(outcome).toBe("PDF_TIMEOUT");
    expect(task.destroy).toHaveBeenCalled();
  });

  it("uses one absolute deadline across cumulative page checks", async () => {
    const delayed = <T>(value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), 40));
    const page = createPage({
      getAnnotations: vi.fn(() => delayed([])),
      getJSActions: vi.fn(() => delayed(null)),
      getXfa: vi.fn(() => delayed(null)),
    });
    const { task } = installDocument(
      createDocument({
        getAttachments: vi.fn(() => delayed(null)),
        getJSActions: vi.fn(() => delayed(null)),
        getOpenAction: vi.fn(() => delayed(null)),
        getOutline: vi.fn(() => delayed(null)),
        getPage: vi.fn(() => delayed(page)),
        numPages: 2,
      }),
    );

    await expect(inspectPdf(minimalPdf, { timeoutMs: 100 })).rejects.toThrow("PDF_TIMEOUT");
    expect(task.destroy).toHaveBeenCalled();
  });
});

describe("bounded PDF text extraction", () => {
  it("extracts selected one-based pages with NFKC and control normalization", async () => {
    const page = createPage({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "Ａ\u0000\r\nB" }, { str: "\tC" }],
        styles: {},
      })),
    });
    const { task } = installDocument(createDocument({}, page));

    const result = await extractPdfText(minimalPdf, { pages: [1] });
    expect(result).toEqual({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "A\nB C" }],
      text: "A\nB C",
    });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result.pages[0])).toBe(true);
    expect(task.destroy).toHaveBeenCalled();
  });

  it("rejects invalid page selections, hostile text items, and text output bombs", async () => {
    await expect(extractPdfText(minimalPdf, { pages: [0] })).rejects.toThrow(
      "PDF_PAGE_OUT_OF_RANGE",
    );
    await expect(extractPdfText(minimalPdf, { pages: [2] })).rejects.toThrow(
      "PDF_PAGE_OUT_OF_RANGE",
    );

    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "str", {
      get() {
        throw new Error("private text");
      },
    });
    installDocument(
      createDocument(
        {},
        createPage({ getTextContent: vi.fn(async () => ({ items: [accessor] })) }),
      ),
    );
    await expect(extractPdfText(minimalPdf)).rejects.toThrow("PDF_SECURITY_VIOLATION");

    installDocument(
      createDocument(
        {},
        createPage({
          getTextContent: vi.fn(async () => ({
            items: [{ str: "x".repeat(PDF_LIMITS.maxTextChars + 1) }],
          })),
        }),
      ),
    );
    await expect(extractPdfText(minimalPdf)).rejects.toThrow("PDF_TEXT_LIMIT");
  });

  it("cancels in-flight extraction and destroys the document", async () => {
    const text = deferred<{ items: readonly unknown[] }>();
    const page = createPage({ getTextContent: vi.fn(() => text.promise) });
    const { task } = installDocument(createDocument({}, page));
    const controller = new AbortController();
    const pending = extractPdfText(minimalPdf, { signal: controller.signal });
    await vi.waitFor(() => expect(page.getTextContent).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    expect(task.destroy).toHaveBeenCalled();
  });

  it("rejects active content on an unselected page before extracting text", async () => {
    const safe = createPage();
    const unsafe = createPage({
      getAnnotations: vi.fn(async () => [{ action: "Launch" }]),
    });
    installDocument(
      createDocument({
        getPage: vi.fn(async (pageNumber: number) => (pageNumber === 1 ? safe : unsafe)),
        numPages: 2,
      }),
    );
    await expect(extractPdfText(minimalPdf, { pages: [1] })).rejects.toThrow(
      "PDF_SECURITY_VIOLATION",
    );
    expect(unsafe.cleanup).toHaveBeenCalled();
  });
});

describe("bounded OffscreenCanvas rendering", () => {
  it("renders locally with annotations disabled, bounded scale, cleanup, and PNG output", async () => {
    const canvases: Array<{
      convertToBlob: ReturnType<typeof vi.fn>;
      getContext: ReturnType<typeof vi.fn>;
      height: number;
      width: number;
    }> = [];
    class TestCanvas {
      width: number;
      height: number;
      getContext = vi.fn(() => ({ kind: "2d" }));
      convertToBlob = vi.fn(
        async () =>
          new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
            type: "image/png",
          }),
      );
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        canvases.push(this);
      }
    }
    vi.stubGlobal("OffscreenCanvas", TestCanvas);
    const page = createPage();
    const { task } = installDocument(createDocument({}, page));

    const result = await renderPdfPage(minimalPdf, { pageNumber: 1, scale: 2 });
    expect(result.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({ annotationMode: 0, intent: "display" }),
    );
    expect(page.cleanup).toHaveBeenCalled();
    expect(canvases[0]?.width).toBe(0);
    expect(canvases[0]?.height).toBe(0);
    expect(task.destroy).toHaveBeenCalled();
  });

  it("rejects scale and render pixel bombs before canvas allocation", async () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      vi.fn(() => {
        throw new Error("must not allocate");
      }),
    );
    await expect(renderPdfPage(minimalPdf, { pageNumber: 1, scale: 0 })).rejects.toThrow(
      "PDF_RENDER_LIMIT",
    );
    const page = createPage({
      getViewport: vi.fn(() => ({
        height: PDF_LIMITS.maxRenderDimension,
        rotation: 0,
        width: PDF_LIMITS.maxRenderDimension,
      })),
    });
    installDocument(createDocument({}, page));
    await expect(renderPdfPage(minimalPdf, { pageNumber: 1, scale: 1 })).rejects.toThrow(
      "PDF_RENDER_LIMIT",
    );
  });

  it("renders JPEG with bounded quality and validates its exact signature", async () => {
    const convertToBlob = vi.fn(
      async () =>
        new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 255, 217])], {
          type: "image/jpeg",
        }),
    );
    class JpegCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { kind: "2d" };
      }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal("OffscreenCanvas", JpegCanvas);
    installDocument();

    const result = await renderPdfPage(minimalPdf, {
      format: "jpg",
      pageNumber: 1,
      quality: 85,
    });
    expect(result.slice(0, 3)).toEqual(new Uint8Array([255, 216, 255]));
    expect(convertToBlob).toHaveBeenCalledWith({ quality: 0.85, type: "image/jpeg" });

    for (const quality of [0, 101, Number.NaN]) {
      await expect(
        renderPdfPage(minimalPdf, { format: "jpg", pageNumber: 1, quality }),
      ).rejects.toThrow("PDF_RENDER_LIMIT");
    }
  });

  it("cancels an in-flight RenderTask and releases page, canvas, and document resources", async () => {
    const rendering = deferred<void>();
    const renderTask = { cancel: vi.fn(), promise: rendering.promise };
    const page = createPage({ render: vi.fn(() => renderTask) });
    const canvases: Array<{ height: number; width: number }> = [];
    class TestCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        canvases.push(this);
      }
      getContext() {
        return { kind: "2d" };
      }
      async convertToBlob() {
        return new Blob([]);
      }
    }
    vi.stubGlobal("OffscreenCanvas", TestCanvas);
    const { task } = installDocument(createDocument({}, page));
    const controller = new AbortController();
    const pending = renderPdfPage(minimalPdf, { pageNumber: 1, signal: controller.signal });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    expect(renderTask.cancel).toHaveBeenCalled();
    expect(page.cleanup).toHaveBeenCalled();
    expect(canvases[0]?.width).toBe(0);
    expect(canvases[0]?.height).toBe(0);
    expect(task.destroy).toHaveBeenCalled();
    rendering.resolve();
  });

  it("rejects active content on any page and requires the exact PNG signature", async () => {
    class InvalidPngCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { kind: "2d" };
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([0, 80, 78, 71, 13, 10, 26, 10])]);
      }
    }
    vi.stubGlobal("OffscreenCanvas", InvalidPngCanvas);
    await expect(renderPdfPage(minimalPdf, { pageNumber: 1 })).rejects.toThrow("PDF_RENDER_LIMIT");

    const safe = createPage();
    const unsafe = createPage({ getJSActions: vi.fn(async () => ({ Open: ["alert(1)"] })) });
    installDocument(
      createDocument({
        getPage: vi.fn(async (pageNumber: number) => (pageNumber === 1 ? safe : unsafe)),
        numPages: 2,
      }),
    );
    await expect(renderPdfPage(minimalPdf, { pageNumber: 1 })).rejects.toThrow(
      "PDF_SECURITY_VIOLATION",
    );
    expect(unsafe.cleanup).toHaveBeenCalled();
  });
});
