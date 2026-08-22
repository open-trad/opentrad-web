import { createInternalProcessSpec } from "../processRunner.js";
import type { PolicyContext, PolicyResolution } from "./workspace.js";

export function resolveImagePolicy(context: PolicyContext): PolicyResolution {
  if (context.request.operation !== "image.convert.hq") throw new Error("CONVERSION_FAILED");
  const output = `${context.workspace.root}/result.${context.request.outputFormat}`;
  return {
    commands: [
      createInternalProcessSpec(
        "vips",
        ["copy", context.workspace.stagedInput, output, "--strip"],
        60_000,
        "image",
      ),
    ],
    expectedArtifacts: [{ format: context.request.outputFormat, path: output, role: "result" }],
  };
}
