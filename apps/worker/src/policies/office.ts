import { createInternalProcessSpec } from "../processRunner.js";
import type { PolicyContext, PolicyResolution } from "./workspace.js";

export function resolveOfficePolicy(context: PolicyContext): PolicyResolution {
  const outputDirectory = `${context.workspace.root}/office-output`;
  const output = `${outputDirectory}/input.pdf`;
  return {
    commands: [
      createInternalProcessSpec(
        "libreoffice",
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--nofirststartwizard",
          `-env:UserInstallation=file://${context.workspace.root}/libreoffice-profile`,
          "--convert-to",
          "pdf",
          "--outdir",
          outputDirectory,
          context.workspace.stagedInput,
        ],
        120_000,
        "libreoffice",
      ),
    ],
    expectedArtifacts: [{ format: "pdf", path: output, role: "result" }],
  };
}
