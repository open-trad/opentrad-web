import { createInternalProcessSpec } from "../processRunner.js";
import type { PolicyContext, PolicyResolution } from "./workspace.js";

export function resolvePdfRepairPolicy(context: PolicyContext): PolicyResolution {
  const output = `${context.workspace.root}/result.pdf`;
  return {
    commands: [
      createInternalProcessSpec(
        "qpdf",
        ["--warning-exit-0", "--object-streams=generate", context.workspace.stagedInput, output],
        90_000,
        "base",
      ),
    ],
    expectedArtifacts: [{ format: "pdf", path: output, role: "result" }],
  };
}

export function resolvePdfTextToDocxPolicy(context: PolicyContext): PolicyResolution {
  const extracted = `${context.workspace.root}/extracted.txt`;
  const output = `${context.workspace.root}/result.docx`;
  return {
    commands: [
      createInternalProcessSpec(
        "pdftotext",
        ["-enc", "UTF-8", "-nopgbrk", context.workspace.stagedInput, extracted],
        30_000,
        "base",
      ),
      createInternalProcessSpec(
        "pandoc",
        ["--sandbox", "--from", "plain", "--to", "docx", "--output", output, extracted],
        90_000,
        "base",
      ),
    ],
    expectedArtifacts: [
      { format: "txt", path: extracted, role: "intermediate" },
      { format: "docx", path: output, role: "result" },
    ],
  };
}
