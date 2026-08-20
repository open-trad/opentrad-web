import { createTemplateRegistry } from "../registry.js";
import { SERVICE_PROJECT_QUOTE_REGISTRATION } from "./quotes/service-project.js";

export * from "./quote-common.js";
export * from "./quotes/service-project.js";
export * from "./quotes/shared.js";

export const V2_TEMPLATE_REGISTRY = createTemplateRegistry([SERVICE_PROJECT_QUOTE_REGISTRATION]);
