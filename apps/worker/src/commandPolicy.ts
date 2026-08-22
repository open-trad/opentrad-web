import { isProxy } from "node:util/types";
import {
  type ConversionOperation,
  type CreateJobRequest,
  CreateJobRequestSchema,
  type FileFormat,
} from "@opentrad/contracts";
import { type Hardened, hardenWorkerValue } from "./manifest.js";
import type { WorkerToolName } from "./toolchain.js";

export const SERVER_OPERATION_IDS = Object.freeze([
  "office.to.pdf",
  "spreadsheet.to.csv",
  "structured.convert",
  "ocr.pdf",
  "ocr.image",
  "image.convert.hq",
  "pdf.repair",
  "pdf.text-to-docx",
  "bid.assemble",
] as const satisfies readonly ConversionOperation[]);

type WorkerAdapter =
  | "office-convert"
  | "spreadsheet-to-csv"
  | "structured-convert"
  | "ocr-pdf"
  | "ocr-image"
  | "image-convert"
  | "pdf-repair"
  | "pdf-text-to-docx"
  | "bid-assembly";

interface WorkerCommandPolicyShape {
  operation: ConversionOperation;
  inputFormat: FileFormat;
  outputFormat: FileFormat;
  adapter: WorkerAdapter;
  tools: readonly WorkerToolName[];
  parameters: Readonly<Record<string, string | number>>;
  timeoutMs: number;
  shell: false;
  network: "none";
  pathDiscovery: false;
}

export type WorkerCommandPolicy = Hardened<WorkerCommandPolicyShape>;

function rejectBoundaryProxy(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  if (isProxy(input)) throw new Error("proxy");
  const options = Reflect.getOwnPropertyDescriptor(input, "options");
  if (
    options &&
    "value" in options &&
    options.value !== null &&
    typeof options.value === "object" &&
    isProxy(options.value)
  ) {
    throw new Error("proxy");
  }
}

function parameters(request: CreateJobRequest): Record<string, string | number> {
  switch (request.operation) {
    case "spreadsheet.to.csv":
      return request.options.sheetIndex === undefined
        ? {}
        : { sheetIndex: request.options.sheetIndex };
    case "ocr.pdf":
    case "ocr.image":
      return request.options.language === undefined ? {} : { language: request.options.language };
    case "bid.assemble":
      return {
        templateId: request.options.templateId,
        templateVersion: request.options.templateVersion,
      };
    case "office.to.pdf":
    case "structured.convert":
    case "image.convert.hq":
    case "pdf.repair":
    case "pdf.text-to-docx":
      return {};
  }
}

function route(request: CreateJobRequest): {
  adapter: WorkerAdapter;
  tools: readonly WorkerToolName[];
  timeoutMs: number;
} {
  switch (request.operation) {
    case "office.to.pdf":
      return { adapter: "office-convert", tools: ["libreoffice"], timeoutMs: 120_000 };
    case "spreadsheet.to.csv":
      return { adapter: "spreadsheet-to-csv", tools: [], timeoutMs: 30_000 };
    case "structured.convert":
      return { adapter: "structured-convert", tools: ["pandoc"], timeoutMs: 90_000 };
    case "ocr.pdf":
      return {
        adapter: "ocr-pdf",
        tools: request.outputFormat === "txt" ? ["ocrmypdf", "pdftotext"] : ["ocrmypdf"],
        timeoutMs: request.outputFormat === "txt" ? 330_000 : 300_000,
      };
    case "ocr.image":
      return {
        adapter: "ocr-image",
        tools: request.outputFormat === "pdf" ? ["tesseract", "qpdf"] : ["tesseract"],
        timeoutMs: 120_000,
      };
    case "image.convert.hq":
      return { adapter: "image-convert", tools: ["vips"], timeoutMs: 60_000 };
    case "pdf.repair":
      return { adapter: "pdf-repair", tools: ["qpdf"], timeoutMs: 90_000 };
    case "pdf.text-to-docx":
      return {
        adapter: "pdf-text-to-docx",
        tools: ["pdftotext", "pandoc"],
        timeoutMs: 120_000,
      };
    case "bid.assemble":
      return {
        adapter: "bid-assembly",
        tools:
          request.outputFormat === "pdf"
            ? ["pdfinfo", "pdftoppm", "vips", "libreoffice", "qpdf"]
            : ["pdfinfo", "pdftoppm", "vips", "libreoffice"],
        timeoutMs: 300_000,
      };
  }
}

export function resolveCommandPolicy(input: unknown): WorkerCommandPolicy {
  try {
    rejectBoundaryProxy(input);
    const request = CreateJobRequestSchema.parse(input);
    const resolved = route(request);
    return hardenWorkerValue({
      operation: request.operation,
      inputFormat: request.inputFormat,
      outputFormat: request.outputFormat,
      adapter: resolved.adapter,
      tools: resolved.tools,
      parameters: parameters(request),
      timeoutMs: resolved.timeoutMs,
      shell: false as const,
      network: "none" as const,
      pathDiscovery: false as const,
    });
  } catch {
    throw new Error("Unsupported worker command");
  }
}
