import { open, readFile } from "node:fs/promises";
import type { CreateJobRequest } from "@opentrad/contracts";
import { JobFileError } from "./jobFiles.js";
import { preflightOpenTradArchive } from "./opentradPreflight.js";
import { inspectPdfBytes, PdfInspectionError } from "./pdfInspector.js";

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function starts(bytes: Buffer, prefix: Buffer | string): boolean {
  const expected = typeof prefix === "string" ? Buffer.from(prefix, "binary") : prefix;
  return bytes.length >= expected.length && bytes.subarray(0, expected.length).equals(expected);
}

function matchesMagic(bytes: Buffer, format: CreateJobRequest["inputFormat"]): boolean {
  switch (format) {
    case "doc":
    case "xls":
    case "ppt":
      return starts(bytes, OLE);
    case "docx":
    case "xlsx":
    case "ods":
    case "pptx":
    case "odp":
    case "odt":
      return starts(bytes, "PK\x03\x04");
    case "rtf":
      return starts(bytes, "{\\rtf");
    case "pdf":
      return starts(bytes, "%PDF-");
    case "png":
      return starts(bytes, PNG);
    case "jpg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "webp":
      return starts(bytes, "RIFF") && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    case "avif":
      if (bytes.length < 16 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
      {
        const boxSize = bytes.readUInt32BE(0);
        if (boxSize < 16) return false;
        const brands = [bytes.subarray(8, 12).toString("ascii")];
        for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
          brands.push(bytes.subarray(offset, offset + 4).toString("ascii"));
        }
        return brands.includes("avif") || brands.includes("avis");
      }
    case "html":
      return /^\s*(?:<!doctype\s+html|<html|<[a-z])/iu.test(bytes.toString("utf8"));
    case "md":
      return !bytes.includes(0);
    default:
      return false;
  }
}

export async function preflightJobInput(
  path: string,
  request: CreateJobRequest,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (request.operation === "bid.assemble") {
      await preflightOpenTradArchive(path, request.options, signal);
      return;
    }
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(32);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      if (
        signal?.aborted ||
        !matchesMagic(buffer.subarray(0, result.bytesRead), request.inputFormat)
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
    } finally {
      await handle.close();
    }
    if (request.inputFormat === "pdf") {
      try {
        await inspectPdfBytes(
          await readFile(path),
          request.operation === "ocr.pdf" ? 20 : 80,
          signal,
        );
      } catch (error) {
        if (error instanceof PdfInspectionError) throw new JobFileError(error.code);
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof JobFileError) throw error;
    throw new JobFileError("INVALID_REQUEST");
  }
}
