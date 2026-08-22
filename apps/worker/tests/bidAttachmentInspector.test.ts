import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  BidAttachmentInspectionError,
  inspectBidActiveGraphForTesting,
  inspectBidAttachmentBytes,
  inspectBidRasterJpegBytes,
} from "../src/adapters/bidAttachmentInspector.js";

const REAL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2vwP4V0658FeH53XDS6fbuf3UTcmNT1KEn6kk0UUV01Mny+Um3Qg2/wC7H/I+BxdSf1ipr1f5n//Z";
const VALID_JPEG = Uint8Array.from(Buffer.from(REAL_JPEG_BASE64, "base64"));

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(output.subarray(4, 8 + data.byteLength)));
  return output;
}

function png(width = 1, height = 1, animated = false): Uint8Array {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 3));
  const chunks = [
    pngChunk("IHDR", header),
    ...(animated ? [pngChunk("acTL", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0))] : []),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const output = new Uint8Array(
    signature.byteLength + chunks.reduce((sum, item) => sum + item.byteLength, 0),
  );
  output.set(signature);
  let offset = signature.byteLength;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function pdf(pageCount: number, active = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([595.28, 841.89]);
  if (active) document.addJavaScript("OpenTradActive", "app.alert('blocked')");
  return document.save({ useObjectStreams: true });
}

function fixedFailure(error: unknown): boolean {
  return (
    error instanceof BidAttachmentInspectionError &&
    error.code === "ATTACHMENT_INVALID" &&
    error.message === "ATTACHMENT_INVALID"
  );
}

describe("bid attachment byte inspector", () => {
  it("rejects invalid bytes with one fixed non-disclosing error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      inspectBidAttachmentBytes(Uint8Array.of(1, 2, 3), "image/png", 1),
    ).rejects.toSatisfy(fixedFailure);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects media/page limits before parsing", async () => {
    await expect(
      inspectBidAttachmentBytes(new Uint8Array(), "application/pdf", 0),
    ).rejects.toSatisfy(fixedFailure);
  });

  it("semantically inspects real object-stream PDFs and every page", async () => {
    const twoPages = await pdf(2);
    const result = await inspectBidAttachmentBytes(twoPages, "application/pdf", 2);
    expect(result).toEqual({ pageCount: 2 });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    await expect(inspectBidAttachmentBytes(twoPages, "application/pdf", 1)).rejects.toSatisfy(
      fixedFailure,
    );
    await expect(
      inspectBidAttachmentBytes(await pdf(1, true), "application/pdf", 10_000),
    ).rejects.toSatisfy(fixedFailure);
  });

  it("accepts excluded-source PDF page counts beyond the included budget", async () => {
    await expect(
      inspectBidAttachmentBytes(await pdf(110), "application/pdf", 10_000),
    ).resolves.toEqual({ pageCount: 110 });
  }, 20_000);

  it("strictly validates static PNG and JPEG structure before native decoding", async () => {
    await expect(inspectBidAttachmentBytes(png(), "image/png", 1)).resolves.toEqual({
      pageCount: 1,
    });
    await expect(inspectBidAttachmentBytes(VALID_JPEG.slice(), "image/jpeg", 1)).resolves.toEqual({
      pageCount: 1,
    });

    const corrupt = png();
    corrupt[corrupt.byteLength - 1] = (corrupt[corrupt.byteLength - 1] ?? 0) ^ 1;
    for (const candidate of [corrupt, png(20_000, 1), png(1, 1, true)]) {
      await expect(inspectBidAttachmentBytes(candidate, "image/png", 1)).rejects.toSatisfy(
        fixedFailure,
      );
    }
    await expect(
      inspectBidAttachmentBytes(VALID_JPEG.subarray(0, VALID_JPEG.byteLength - 1), "image/jpeg", 1),
    ).rejects.toSatisfy(fixedFailure);
  });

  it("returns exact dimensions only for a validated renderer JPEG", () => {
    expect(inspectBidRasterJpegBytes(VALID_JPEG.slice())).toEqual({
      heightPixels: 4,
      widthPixels: 2,
    });
    expect(() => inspectBidRasterJpegBytes(VALID_JPEG.subarray(0, 20))).toThrow(
      "ATTACHMENT_INVALID",
    );
  });

  it("copies exact bytes and rejects hostile typed-array shapes", async () => {
    const cases: unknown[] = [Buffer.from(VALID_JPEG), new Proxy(VALID_JPEG, {})];
    if (typeof SharedArrayBuffer === "function") {
      cases.push(new Uint8Array(new SharedArrayBuffer(VALID_JPEG.byteLength)));
    }
    const detached = VALID_JPEG.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    cases.push(detached);
    for (const candidate of cases) {
      await expect(inspectBidAttachmentBytes(candidate, "image/jpeg", 1)).rejects.toSatisfy(
        fixedFailure,
      );
    }
  });

  it("honors abort and one absolute deadline with fixed errors", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectBidAttachmentBytes(await pdf(1), "application/pdf", 1, controller.signal),
    ).rejects.toSatisfy(fixedFailure);
    await expect(
      inspectBidAttachmentBytes(await pdf(1), "application/pdf", 1, undefined, Date.now() - 1),
    ).rejects.toSatisfy(fixedFailure);
  });

  it("fails closed on hostile PDF.js graph containers without invoking accessors", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "url", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("PRIVATE_GRAPH_VALUE");
      },
    });
    const extraArray = [Object.create(null)];
    Object.defineProperty(extraArray, "extra", { enumerable: true, value: true });

    for (const candidate of [new Proxy({}, {}), accessor, extraArray]) {
      expect(() => inspectBidActiveGraphForTesting(candidate)).toThrow("ATTACHMENT_INVALID");
    }
    expect(getterCalls).toBe(0);
  });
});
