import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertDocx, DOCX_LIMITS, dispatchDocxConversion } from "../src/docx/convertDocx.js";
import type { LocalConversionRequest } from "../src/protocol.js";
import { installLocalConversionWorker } from "../src/worker.js";

const mammothMock = vi.hoisted(() => ({
  convertToHtml: vi.fn(),
  extractRawText: vi.fn(),
}));

vi.mock("mammoth", () => ({ default: mammothMock }));

const MiB = 1024 * 1024;
const utf8 = new TextEncoder();
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

interface ZipEntry {
  readonly name: string;
  readonly data?: Uint8Array | string;
  readonly flags?: number;
  readonly method?: number;
  readonly versionMadeBy?: number;
  readonly externalAttributes?: number;
  readonly compressedSize?: number;
  readonly crc32?: number;
  readonly uncompressedSize?: number;
  readonly localName?: string;
  readonly localOffset?: number;
  readonly extra?: Uint8Array;
}

interface ZipOptions {
  readonly disk?: number;
  readonly centralDisk?: number;
  readonly entriesOnDisk?: number;
  readonly totalEntries?: number;
  readonly centralOffset?: number;
}

function u16(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function u32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function storedZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const offsets: number[] = [];
  let localLength = 0;

  for (const entry of entries) {
    const localName = utf8.encode(entry.localName ?? entry.name);
    const data =
      typeof entry.data === "string" ? utf8.encode(entry.data) : (entry.data ?? new Uint8Array());
    const extra = entry.extra ?? new Uint8Array();
    const compressedSize = entry.compressedSize ?? data.byteLength;
    const uncompressedSize = entry.uncompressedSize ?? data.byteLength;
    const header = new Uint8Array(30);
    u32(header, 0, 0x04034b50);
    u16(header, 4, 20);
    u16(header, 6, entry.flags ?? 0x0800);
    u16(header, 8, entry.method ?? 0);
    u32(header, 14, entry.crc32 ?? crc32(data));
    u32(header, 18, compressedSize);
    u32(header, 22, uncompressedSize);
    u16(header, 26, localName.byteLength);
    u16(header, 28, extra.byteLength);
    offsets.push(localLength);
    const local = concat([header, localName, extra, data]);
    locals.push(local);
    localLength += local.byteLength;
  }

  entries.forEach((entry, index) => {
    const name = utf8.encode(entry.name);
    const data =
      typeof entry.data === "string" ? utf8.encode(entry.data) : (entry.data ?? new Uint8Array());
    const extra = entry.extra ?? new Uint8Array();
    const central = new Uint8Array(46);
    u32(central, 0, 0x02014b50);
    u16(central, 4, entry.versionMadeBy ?? 20);
    u16(central, 6, 20);
    u16(central, 8, entry.flags ?? 0x0800);
    u16(central, 10, entry.method ?? 0);
    u32(central, 16, entry.crc32 ?? crc32(data));
    u32(central, 20, entry.compressedSize ?? data.byteLength);
    u32(central, 24, entry.uncompressedSize ?? data.byteLength);
    u16(central, 28, name.byteLength);
    u16(central, 30, extra.byteLength);
    u32(central, 38, entry.externalAttributes ?? 0);
    u32(central, 42, entry.localOffset ?? offsets[index] ?? 0);
    centrals.push(concat([central, name, extra]));
  });

  const localBytes = concat(locals);
  const centralBytes = concat(centrals);
  const eocd = new Uint8Array(22);
  u32(eocd, 0, 0x06054b50);
  u16(eocd, 4, options.disk ?? 0);
  u16(eocd, 6, options.centralDisk ?? 0);
  u16(eocd, 8, options.entriesOnDisk ?? entries.length);
  u16(eocd, 10, options.totalEntries ?? entries.length);
  u32(eocd, 12, centralBytes.byteLength);
  u32(eocd, 16, options.centralOffset ?? localBytes.byteLength);
  return concat([localBytes, centralBytes, eocd]);
}

const contentTypes =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const rootRels =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const documentXml =
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>OpenTrad</w:t></w:r></w:p></w:body></w:document>';

function safeDocx(extra: readonly ZipEntry[] = []): Uint8Array {
  return storedZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "word/document.xml", data: documentXml },
    ...extra,
  ]);
}

function docxRequest(outputFormat: "html" | "md" | "txt"): LocalConversionRequest {
  return {
    id: crypto.randomUUID(),
    operation: "docx.extract",
    inputFormat: "docx",
    outputFormat,
    bytes: safeDocx() as Uint8Array<ArrayBuffer>,
    options: {},
  };
}

beforeEach(() => {
  mammothMock.convertToHtml.mockReset().mockResolvedValue({
    value: '<a href="javascript:alert(1)">bad</a><p>Ａsafe\r</p>',
    messages: [],
  });
  mammothMock.extractRawText
    .mockReset()
    .mockResolvedValue({ value: "Ａsafe\r\ntext", messages: [] });
});

describe("DOCX ZIP preflight", () => {
  it("publishes frozen null-prototype limits", () => {
    expect(Object.isFrozen(DOCX_LIMITS)).toBe(true);
    expect(Object.getPrototypeOf(DOCX_LIMITS)).toBeNull();
  });

  it("rejects oversized input and excessive entry counts before Mammoth", async () => {
    await expect(convertDocx(new Uint8Array(25 * MiB + 1), "html")).rejects.toThrow(
      "LOCAL_DOCX_LIMIT_EXCEEDED",
    );
    const entries = Array.from({ length: 1_025 }, (_, index) => ({
      name: `word/item-${index}.bin`,
      data: "x",
    }));
    await expect(convertDocx(storedZip(entries), "html")).rejects.toThrow(
      "LOCAL_DOCX_LIMIT_EXCEEDED",
    );
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it.each([
    [
      "duplicate",
      [
        { name: "word/document.xml", data: "a" },
        { name: "word/document.xml", data: "b" },
      ],
    ],
    [
      "case duplicate",
      [
        { name: "word/DOCUMENT.xml", data: "a" },
        { name: "word/document.xml", data: "b" },
      ],
    ],
    ["absolute", [{ name: "/word/document.xml", data: "a" }]],
    ["drive absolute", [{ name: "C:/word/document.xml", data: "a" }]],
    ["backslash", [{ name: "word\\document.xml", data: "a" }]],
    ["empty segment", [{ name: "word//document.xml", data: "a" }]],
    ["traversal", [{ name: "word/../private.xml", data: "a" }]],
  ])("rejects %s entry paths", async (_label, entries) => {
    await expect(convertDocx(storedZip(entries), "html")).rejects.toThrow(
      "LOCAL_DOCX_SECURITY_VIOLATION",
    );
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("rejects encrypted, multi-disk, ZIP64, inconsistent, and overlapping archives", async () => {
    const zip64Extra = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    const cases = [
      storedZip([{ name: "word/document.xml", data: "x", flags: 0x0801 }]),
      storedZip([{ name: "word/document.xml", data: "x" }], { disk: 1 }),
      storedZip([{ name: "word/document.xml", data: "x", extra: zip64Extra }]),
      storedZip([{ name: "word/document.xml", localName: "word/other.xml", data: "x" }]),
      storedZip([
        { name: "a.bin", data: new Uint8Array(40), method: 8, compressedSize: 90 },
        { name: "b.bin", data: "x" },
      ]),
    ];
    for (const bytes of cases) {
      await expect(convertDocx(bytes, "html")).rejects.toThrow("LOCAL_DOCX_INVALID");
    }
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("rejects symbolic links", async () => {
    const unixSymlink = (0o120777 << 16) >>> 0;
    await expect(
      convertDocx(
        storedZip([
          {
            name: "word/link.xml",
            data: documentXml,
            versionMadeBy: 0x0314,
            externalAttributes: unixSymlink,
          },
        ]),
        "html",
      ),
    ).rejects.toThrow("LOCAL_DOCX_SECURITY_VIOLATION");
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("rejects single-entry, total-uncompressed, ratio, and XML budgets", async () => {
    const cases = [
      storedZip([{ name: "word/large.bin", data: "x", uncompressedSize: 16 * MiB + 1 }]),
      storedZip([
        { name: "a.bin", data: "x", uncompressedSize: 40 * MiB },
        { name: "b.bin", data: "x", uncompressedSize: 40 * MiB },
      ]),
      storedZip([{ name: "word/bomb.bin", data: "x", uncompressedSize: 101 }]),
      storedZip([{ name: "word/large.xml", data: new Uint8Array(6 * MiB + 1) }]),
      storedZip([
        { name: "word/a.xml", data: new Uint8Array(6 * MiB) },
        { name: "word/b.xml", data: new Uint8Array(6 * MiB) },
        { name: "word/c.xml", data: new Uint8Array(6 * MiB) },
        { name: "word/d.xml", data: new Uint8Array(2 * MiB + 1) },
      ]),
    ];
    for (const bytes of cases) {
      await expect(convertDocx(bytes, "html")).rejects.toThrow("LOCAL_DOCX_LIMIT_EXCEEDED");
    }
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("strictly decodes every XML and relationship part as UTF-8", async () => {
    for (const entry of [
      { name: "word/bad.xml", data: new Uint8Array([0xc3, 0x28]) },
      { name: "word/_rels/bad.rels", data: new Uint8Array([0x81]) },
    ]) {
      await expect(convertDocx(storedZip([entry]), "html")).rejects.toThrow("LOCAL_DOCX_INVALID");
    }
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("inflates and verifies length and CRC for corrupt non-XML entries before Mammoth", async () => {
    for (const bytes of [
      safeDocx([{ name: "word/media/image1.png", data: "private-media", crc32: 0 }]),
      safeDocx([{ name: "word/media/image1.png", data: "not-deflate", method: 8 }]),
    ]) {
      await expect(convertDocx(bytes, "html")).rejects.toThrow("LOCAL_DOCX_INVALID");
    }
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("cancels the active decompression reader when aborted", async () => {
    const pull = vi.fn(() => new Promise<void>(() => undefined));
    const cancel = vi.fn();
    const readable = new ReadableStream<Uint8Array>({ cancel, pull });
    const writable = new WritableStream<Uint8Array>();
    class FakeDecompressionStream {
      readonly readable = readable;
      readonly writable = writable;
    }
    vi.stubGlobal("DecompressionStream", FakeDecompressionStream);
    try {
      const bytes = storedZip([
        { name: "[Content_Types].xml", data: contentTypes },
        { name: "_rels/.rels", data: rootRels },
        {
          name: "word/document.xml",
          data: new Uint8Array([1]),
          method: 8,
          uncompressedSize: 1,
        },
      ]);
      const controller = new AbortController();
      const pending = convertDocx(bytes, "html", controller.signal);
      await vi.waitFor(() => expect(pull).toHaveBeenCalled());
      controller.abort({ filename: "private.docx" });
      await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("DOCX active-content policy", () => {
  it.each([
    ["macro content type", "application/vnd.ms-word.document.macro&#x45;nabled.main+xml"],
    ["OLE content type", "application/vnd.openxmlformats-officedocument.ole&#79;bject"],
    ["ActiveX content type", "application/vnd.openxmlformats-officedocument.active&#x58;+xml"],
  ])("rejects numeric-reference encoded %s", async (_label, contentType) => {
    await expect(
      convertDocx(
        storedZip([
          {
            name: "[Content_Types].xml",
            data: `<Types><Override ContentType="${contentType}"/></Types>`,
          },
        ]),
        "html",
      ),
    ).rejects.toThrow("LOCAL_DOCX_SECURITY_VIOLATION");
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it.each([
    ["vbaProject", "vbaProject"],
    ["oleObject", "oleObject"],
    ["activeX", "activeX"],
    ["activeXControl", "activeXControl"],
    ["activeXControlBinary", "activeXControlBinary"],
    ["control", "control"],
    ["attachedTemplate", "attachedTemplate"],
    ["afChunk", "a&#x46;Chunk"],
  ])("rejects active %s relationship types by complete URI suffix", async (_label, suffix) => {
    const relationships = `<Relationships><Relationship Type="http://schemas.microsoft.com/office/2006/relationships/${suffix}" Target="internal.bin"/></Relationships>`;
    await expect(
      convertDocx(
        storedZip([{ name: "word/_rels/document.xml.rels", data: relationships }]),
        "html",
      ),
    ).rejects.toThrow("LOCAL_DOCX_SECURITY_VIOLATION");
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it.each([
    [
      "external relationship",
      '<Relationships><Relationship TargetMode="External" Target="safe"/></Relationships>',
    ],
    [
      "network target",
      '<Relationships><Relationship Target="https://private.test/x"/></Relationships>',
    ],
    ["file target", '<Relationships><Relationship Target="file:///private"/></Relationships>'],
    ["data target", '<Relationships><Relationship Target="data:text/plain,x"/></Relationships>'],
    [
      "protocol-relative target",
      '<Relationships><Relationship Target="//private.test/x"/></Relationships>',
    ],
    [
      "quoted-angle external relationship",
      '<Relationships><Relationship Note=">" TargetMode="External" Target="safe"/></Relationships>',
    ],
  ])("rejects %s before Mammoth", async (_label, relationships) => {
    await expect(
      convertDocx(
        storedZip([{ name: "word/_rels/document.xml.rels", data: relationships }]),
        "html",
      ),
    ).rejects.toThrow("LOCAL_DOCX_SECURITY_VIOLATION");
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it.each([
    ["OLE embedding", { name: "word/embeddings/oleObject1.bin", data: "private" }],
    ["VBA project", { name: "word/vbaProject.bin", data: "private" }],
    [
      "macro content type",
      {
        name: "[Content_Types].xml",
        data: '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      },
    ],
    [
      "OLE content type",
      {
        name: "[Content_Types].xml",
        data: '<Types><Default ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>',
      },
    ],
    [
      "altChunk tag",
      { name: "word/document.xml", data: '<w:document><w:altChunk r:id="x"/></w:document>' },
    ],
    [
      "afChunk relationship",
      {
        name: "word/_rels/document.xml.rels",
        data: '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>',
      },
    ],
  ])("rejects %s", async (_label, entry) => {
    await expect(convertDocx(storedZip([entry]), "html")).rejects.toThrow(
      "LOCAL_DOCX_SECURITY_VIOLATION",
    );
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });

  it("rejects altChunk with any legal XML namespace prefix", async () => {
    await expect(
      convertDocx(
        storedZip([
          {
            name: "word/document.xml",
            data: '<safe:document xmlns:safe="urn:safe"><evil:altChunk xmlns:evil="urn:evil"/></safe:document>',
          },
        ]),
        "html",
      ),
    ).rejects.toThrow("LOCAL_DOCX_SECURITY_VIOLATION");
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();
  });
});

describe("DOCX intrinsic isolation", () => {
  it("survives prototype pollution triggered by a rejected Proxy without leaking input", async () => {
    const valid = safeDocx();
    const getUint32Descriptor = Reflect.getOwnPropertyDescriptor(DataView.prototype, "getUint32");
    const normalizeDescriptor = Reflect.getOwnPropertyDescriptor(String.prototype, "normalize");
    const privateError = new Error("private.docx secret-body");
    const hostile = new Proxy(new Uint8Array([1]), {
      getPrototypeOf(target) {
        Object.defineProperty(DataView.prototype, "getUint32", {
          configurable: true,
          value: () => {
            throw privateError;
          },
          writable: true,
        });
        Object.defineProperty(String.prototype, "normalize", {
          configurable: true,
          value: () => {
            throw privateError;
          },
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });

    let rejected: unknown;
    let validError: unknown;
    let validOutput: Uint8Array | undefined;
    try {
      try {
        await convertDocx(hostile, "html");
      } catch (error) {
        rejected = error;
      }
      try {
        validOutput = await convertDocx(valid, "html");
      } catch (error) {
        validError = error;
      }
    } finally {
      if (getUint32Descriptor) {
        Reflect.defineProperty(DataView.prototype, "getUint32", getUint32Descriptor);
      }
      if (normalizeDescriptor) {
        Reflect.defineProperty(String.prototype, "normalize", normalizeDescriptor);
      }
    }

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe("LOCAL_DOCX_CONVERSION_FAILED");
    expect((rejected as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(rejected)).not.toMatch(/private|secret/i);
    expect(validError).toBeUndefined();
    expect(validOutput && decodeUtf8(validOutput)).toBe("<a>bad</a><p>Asafe\n</p>");
  });
});

describe("safe DOCX conversion", () => {
  it("calls Mammoth only after preflight and sanitizes HTML through the text boundary", async () => {
    const output = await convertDocx(safeDocx(), "html");
    expect(mammothMock.convertToHtml).toHaveBeenCalledWith(
      { arrayBuffer: expect.any(ArrayBuffer) },
      { externalFileAccess: false, includeDefaultStyleMap: true },
    );
    expect(decodeUtf8(output)).toBe("<a>bad</a><p>Asafe\n</p>");
  });

  it("produces sanitized Markdown and normalized plain text with shared budgets", async () => {
    expect(decodeUtf8(await convertDocx(safeDocx(), "md"))).toBe("bad\n\nAsafe\n");
    expect(decodeUtf8(await convertDocx(safeDocx(), "txt"))).toBe("Asafe\ntext");
    expect(mammothMock.extractRawText).toHaveBeenCalledWith({
      arrayBuffer: expect.any(ArrayBuffer),
    });
  });

  it("honors abort-before and abort-inflight without leaking abort reasons", async () => {
    const before = new AbortController();
    before.abort({ filename: "private.docx" });
    await expect(convertDocx(safeDocx(), "html", before.signal)).rejects.toThrow(
      "LOCAL_CONVERSION_CANCELLED",
    );
    expect(mammothMock.convertToHtml).not.toHaveBeenCalled();

    let resolveMammoth: ((value: { value: string; messages: never[] }) => void) | undefined;
    mammothMock.convertToHtml.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMammoth = resolve;
        }),
    );
    const active = new AbortController();
    const pending = convertDocx(safeDocx(), "html", active.signal);
    await vi.waitFor(() => expect(mammothMock.convertToHtml).toHaveBeenCalledOnce());
    active.abort({ body: "private" });
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    resolveMammoth?.({ value: "<p>late</p>", messages: [] });
  });

  it("returns a finite fixed error without content, filename, cause, or logging", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const privateName = "private-customer.docx";
    let caught: unknown;
    try {
      await convertDocx(storedZip([{ name: privateName, data: "secret-body" }]), "html");
    } catch (error) {
      caught = error;
    } finally {
      consoleError.mockRestore();
    }
    expect(caught).toBeInstanceOf(Error);
    expect([
      "LOCAL_DOCX_INVALID",
      "LOCAL_DOCX_SECURITY_VIOLATION",
      "LOCAL_DOCX_LIMIT_EXCEEDED",
      "LOCAL_DOCX_CONVERSION_FAILED",
    ]).toContain((caught as Error).message);
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(caught)).not.toMatch(/private-customer|secret-body/i);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("adapts docx.extract requests to frozen worker output with exact media types", async () => {
    for (const [format, mediaType] of [
      ["html", "text/html"],
      ["md", "text/markdown"],
      ["txt", "text/plain"],
    ] as const) {
      const result = await dispatchDocxConversion(docxRequest(format));
      expect(result.mediaType).toBe(mediaType);
      expect(Object.isFrozen(result)).toBe(true);
    }
    await expect(
      dispatchDocxConversion({ ...docxRequest("html"), operation: "text.semantic" }),
    ).rejects.toThrow("LOCAL_OPERATION_NOT_IMPLEMENTED");
  });

  it("runs through the strict one-request worker protocol", async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const posts: Array<{ readonly message: unknown; readonly transfer: Transferable[] }> = [];
    const scope = {
      addEventListener: (_type: "message", listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: "message", listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
      postMessage: (message: unknown, transfer: Transferable[] = []) =>
        posts.push({ message: structuredClone(message, { transfer }), transfer }),
    };
    installLocalConversionWorker(scope, dispatchDocxConversion);
    const request = docxRequest("html");
    for (const listener of listeners) listener({ data: request } as MessageEvent<unknown>);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.message).toMatchObject({ id: request.id, ok: true, mediaType: "text/html" });
    expect(posts[0]?.transfer).toHaveLength(1);
  });
});
