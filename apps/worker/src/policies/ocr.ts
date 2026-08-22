import { createInternalProcessSpec } from "../processRunner.js";
import type { PolicyContext, PolicyResolution } from "./workspace.js";

const DEFAULT_OCR_LANGUAGE = "chi_sim+eng" as const;

export function resolveOcrPdfPolicy(context: PolicyContext): PolicyResolution {
  if (context.request.operation !== "ocr.pdf") throw new Error("CONVERSION_FAILED");
  const language = context.request.options.language ?? DEFAULT_OCR_LANGUAGE;
  const ocrOutput =
    context.request.outputFormat === "pdf"
      ? `${context.workspace.root}/result.pdf`
      : `${context.workspace.root}/ocr.pdf`;
  const ocr = createInternalProcessSpec(
    "ocrmypdf",
    [
      "--rasterizer",
      "pypdfium",
      "--output-type",
      "pdf",
      "--optimize",
      "0",
      "--jobs",
      "1",
      "--tesseract-timeout",
      "120",
      "--language",
      language,
      context.workspace.stagedInput,
      ocrOutput,
    ],
    300_000,
    "ocr",
  );
  if (context.request.outputFormat === "pdf") {
    return {
      commands: [ocr],
      expectedArtifacts: [{ format: "pdf", path: ocrOutput, role: "result" }],
    };
  }
  const output = `${context.workspace.root}/result.txt`;
  return {
    commands: [
      ocr,
      createInternalProcessSpec(
        "pdftotext",
        ["-enc", "UTF-8", "-nopgbrk", ocrOutput, output],
        30_000,
        "base",
      ),
    ],
    expectedArtifacts: [
      { format: "pdf", path: ocrOutput, role: "intermediate" },
      { format: "txt", path: output, role: "result" },
    ],
  };
}

export function resolveOcrImagePolicy(context: PolicyContext): PolicyResolution {
  if (context.request.operation !== "ocr.image") throw new Error("CONVERSION_FAILED");
  const language = context.request.options.language ?? DEFAULT_OCR_LANGUAGE;
  const outputBase =
    context.request.outputFormat === "pdf"
      ? `${context.workspace.root}/ocr-image`
      : `${context.workspace.root}/result`;
  const generated = `${outputBase}.${context.request.outputFormat}`;
  const tesseract = createInternalProcessSpec(
    "tesseract",
    [context.workspace.stagedInput, outputBase, "-l", language, context.request.outputFormat],
    90_000,
    "ocr",
  );
  if (context.request.outputFormat === "txt") {
    return {
      commands: [tesseract],
      expectedArtifacts: [{ format: "txt", path: generated, role: "result" }],
    };
  }
  const output = `${context.workspace.root}/result.pdf`;
  return {
    commands: [
      tesseract,
      createInternalProcessSpec(
        "qpdf",
        ["--warning-exit-0", "--object-streams=generate", generated, output],
        30_000,
        "base",
      ),
    ],
    expectedArtifacts: [
      { format: "pdf", path: generated, role: "intermediate" },
      { format: "pdf", path: output, role: "result" },
    ],
  };
}
