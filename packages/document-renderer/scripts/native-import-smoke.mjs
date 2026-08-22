import {
  allocatePercentageWidthsTwips,
  buildDocxPlanV2,
  normalizeDocumentModel,
  renderDocxV2,
} from "../dist/index.js";

const requiredExports = [
  ["allocatePercentageWidthsTwips", allocatePercentageWidthsTwips],
  ["buildDocxPlanV2", buildDocxPlanV2],
  ["normalizeDocumentModel", normalizeDocumentModel],
  ["renderDocxV2", renderDocxV2],
];

for (const [name, value] of requiredExports) {
  if (typeof value !== "function") {
    throw new Error(`Missing native ESM export: ${name}`);
  }
}

const widths = allocatePercentageWidthsTwips(["40%", "60%"], 1_000);
if (widths[0] !== 400 || widths[1] !== 600) {
  throw new Error("Native ESM renderer execution failed");
}

console.log("Native ESM import verified");
