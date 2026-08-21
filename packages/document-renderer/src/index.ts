export type {
  DocxPlanBlockV2,
  DocxPlanSectionV2,
  DocxPlanV2,
  DocxWatermarkPlanV2,
} from "./docx/buildDocxPlan.js";
export {
  A4_PORTRAIT_HEIGHT_TWIPS,
  A4_PORTRAIT_WIDTH_TWIPS,
  buildDocxPlanV2,
} from "./docx/buildDocxPlan.js";
export type { AttachmentPageImage, RenderDocxV2Options } from "./docx/renderDocxV2.js";
export {
  AttachmentPageImagesValidationError,
  DOCX_V2_MIME,
  DocxV2GenerationError,
  renderDocxV2,
} from "./docx/renderDocxV2.js";
export * from "./normalizeModel.js";
export * from "./tableWidths.js";
