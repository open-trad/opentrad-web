export * from "./compiler.js";
export * from "./money.js";
export * from "./project.js";
export * from "./schemas.js";
export type {
  DocumentLanguageV2,
  EntityPartyV2,
  LayoutStyleId,
  LocalizedText,
  SupportedOutputV2,
  TemplateCategoryV2,
  TemplateDefinitionV2,
  TemplateFieldManifestEntryV1,
  TemplateIdV2,
  TemplateVersionV2,
} from "./v2/common.js";
export { TEMPLATE_IDS_V2 } from "./v2/common.js";
export * from "./v2/document-model.js";
export * as v2 from "./v2/index.js";
export type { TemplateRegistration, TemplateRegistry } from "./v2/registry.js";
export { createTemplateRegistry } from "./v2/registry.js";
export * from "./v2/risk.js";
export type { OfficialSourceDescriptor, OfficialSourceKey } from "./v2/source-basis.js";
export { OFFICIAL_SOURCES } from "./v2/source-basis.js";
