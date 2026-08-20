import { createTemplateRegistry } from "../registry.js";
import { OEM_CUSTOM_QUOTE_REGISTRATION } from "./quotes/oem-custom.js";
import { SERVICE_PROJECT_QUOTE_REGISTRATION } from "./quotes/service-project.js";

export * from "./quote-common.js";
export * from "./quotes/oem-custom.js";
export * from "./quotes/service-project.js";
export * from "./quotes/shared.js";

export const V2_TEMPLATE_REGISTRY = createTemplateRegistry([
  SERVICE_PROJECT_QUOTE_REGISTRATION,
  OEM_CUSTOM_QUOTE_REGISTRATION,
]);
