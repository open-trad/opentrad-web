import { createInternalProcessSpec } from "../processRunner.js";
import type { PolicyContext, PolicyResolution } from "./workspace.js";

const PANDOC_READERS = Object.freeze({
  docx: "docx",
  odt: "odt",
  rtf: "rtf",
  html: "html",
  md: "gfm",
} as const);

const PANDOC_WRITERS = Object.freeze({
  docx: "docx",
  odt: "odt",
  rtf: "rtf",
  html: "html5",
  md: "gfm",
} as const);

export function resolveStructuredPandocPolicy(context: PolicyContext): PolicyResolution {
  if (context.request.operation !== "structured.convert") throw new Error("CONVERSION_FAILED");
  const from = PANDOC_READERS[context.request.inputFormat];
  const to = PANDOC_WRITERS[context.request.outputFormat];
  const output = `${context.workspace.root}/result.${context.request.outputFormat}`;
  return {
    commands: [
      createInternalProcessSpec(
        "pandoc",
        [
          "--sandbox",
          "--from",
          from,
          "--to",
          to,
          "--output",
          output,
          context.workspace.stagedInput,
        ],
        90_000,
        "base",
      ),
    ],
    expectedArtifacts: [{ format: context.request.outputFormat, path: output, role: "result" }],
  };
}
