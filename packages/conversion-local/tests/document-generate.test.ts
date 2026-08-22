import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import { generateDocument } from "../src/document/generateDocument.js";

const source = new TextEncoder().encode("标题\n\nOpenTrad 本地文档");
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOvgAADr4B6kKxwAAAABNJREFUKFNj/M+ADzDhlWUYqdIAQSwBE8U+X40AAAAASUVORK5CYII=",
    "base64",
  ),
);

function fakeCanvas(
  onText?: (value: string) => void,
  blob = new Blob([png], { type: "image/png" }),
) {
  return class FakeCanvas {
    getContext() {
      return {
        fillRect: vi.fn(),
        fillStyle: "",
        fillText: vi.fn((value: string) => onText?.(value)),
        font: "",
        measureText: vi.fn((value: string) => ({ width: Array.from(value).length * 24 })),
        textBaseline: "",
      };
    }
    async convertToBlob() {
      return blob;
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function zipEntry(archive: Uint8Array, expectedName: string): Promise<Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let offset = archive.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("missing EOCD");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let index = 0; index < count; index += 1) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    if (name === expectedName) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.slice(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8) throw new Error("unsupported method");
      const inflated = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(inflated).arrayBuffer());
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("missing entry");
}

it("generates a local DOCX with no network access", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const output = await generateDocument(source, "txt", "docx", "utf-8");

  expect(Array.from(output.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(new TextDecoder().decode(await zipEntry(output, "word/document.xml"))).toContain(
    "OpenTrad 本地文档",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("sanitizes HTML before placing its visible text in DOCX", async () => {
  const html = new TextEncoder().encode(
    '<h1 onclick="steal()">安全标题</h1><script>PRIVATE_BODY</script><p>正文</p>',
  );
  const output = await generateDocument(html, "html", "docx", "utf-8");
  const extracted = new TextDecoder().decode(await zipEntry(output, "word/document.xml"));

  expect(extracted).toContain("安全标题");
  expect(extracted).toContain("正文");
  expect(extracted).not.toContain("PRIVATE_BODY");
});

it("generates a local PDF through the browser canvas without fetch", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.stubGlobal("OffscreenCanvas", fakeCanvas());

  const output = await generateDocument(source, "txt", "pdf", "utf-8");
  expect(new TextDecoder("latin1").decode(output.subarray(0, 5))).toBe("%PDF-");
  await expect(PDFDocument.load(output)).resolves.toMatchObject({});
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("rejects unsupported public formats before rendering", async () => {
  const canvas = vi.fn();
  vi.stubGlobal("OffscreenCanvas", canvas);

  await expect(generateDocument(source, "txt", "png" as never, "utf-8")).rejects.toThrow(
    "LOCAL_DOCUMENT_FORMAT_INVALID",
  );
  await expect(generateDocument(source, "rtf" as never, "pdf", "utf-8")).rejects.toThrow(
    "LOCAL_DOCUMENT_FORMAT_INVALID",
  );
  await expect(generateDocument(source, "txt", "pdf", "utf-16" as never)).rejects.toThrow(
    "LOCAL_DOCUMENT_FORMAT_INVALID",
  );
  expect(canvas).not.toHaveBeenCalled();
});

it("never separates grapheme clusters while wrapping measured PDF text", async () => {
  const draws: string[] = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    fakeCanvas((value) => draws.push(value)),
  );
  const text = `a${"b".repeat(43)}😀e\u0301中文`;

  await generateDocument(new TextEncoder().encode(text), "txt", "pdf", "utf-8");

  expect(draws.join("")).toBe(text.normalize("NFC"));
  expect(draws).not.toContain("\ud83d");
  expect(draws).not.toContain("\ude00");
  expect(draws).not.toContain("e");
  expect(draws).not.toContain("\u0301");
});

it("rejects promptly on abort and ignores a late canvas fulfillment", async () => {
  let resolveBlob: ((value: Blob) => void) | undefined;
  const pendingBlob = new Promise<Blob>((resolve) => {
    resolveBlob = resolve;
  });
  class PendingCanvas extends fakeCanvas() {
    override convertToBlob() {
      return pendingBlob;
    }
  }
  vi.stubGlobal("OffscreenCanvas", PendingCanvas);
  const controller = new AbortController();
  const pending = generateDocument(source, "txt", "pdf", "utf-8", controller.signal);
  await vi.waitFor(() => expect(resolveBlob).toBeTypeOf("function"));

  controller.abort();
  await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
  resolveBlob?.(new Blob([png], { type: "image/png" }));
  await Promise.resolve();
});

it("rejects excessive paragraphs before allocating document objects", async () => {
  const oversized = new TextEncoder().encode("x\n".repeat(5_001));
  await expect(generateDocument(oversized, "txt", "docx", "utf-8")).rejects.toThrow(
    "LOCAL_DOCUMENT_LIMIT",
  );
});

it("fails closed when a browser PDF canvas is unavailable", async () => {
  vi.stubGlobal("OffscreenCanvas", undefined);
  await expect(generateDocument(source, "txt", "pdf", "utf-8")).rejects.toThrow(
    "LOCAL_DOCUMENT_RENDER_UNAVAILABLE",
  );
});
