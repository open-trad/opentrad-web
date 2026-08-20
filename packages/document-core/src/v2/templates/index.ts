import { createTemplateRegistry } from "../registry.js";
import { DOMESTIC_SALE_CONTRACT_REGISTRATION } from "./contracts/domestic-sale.js";
import { FRAMEWORK_SUPPLY_CONTRACT_REGISTRATION } from "./contracts/framework-supply.js";
import { OEM_PROCESSING_CONTRACT_REGISTRATION } from "./contracts/oem-processing.js";
import { EXPORT_BILINGUAL_QUOTE_REGISTRATION } from "./quotes/export-bilingual.js";
import { OEM_CUSTOM_QUOTE_REGISTRATION } from "./quotes/oem-custom.js";
import { PROFORMA_INVOICE_REGISTRATION } from "./quotes/proforma-invoice.js";
import { SERVICE_PROJECT_QUOTE_REGISTRATION } from "./quotes/service-project.js";

export * from "./quote-common.js";
export * from "./contracts/domestic-sale.js";
export * from "./contracts/framework-supply.js";
export * from "./contracts/oem-processing.js";
export * from "./quotes/export-bilingual.js";
export * from "./quotes/oem-custom.js";
export * from "./quotes/proforma-invoice.js";
export * from "./quotes/service-project.js";
export * from "./quotes/shared.js";

export const V2_TEMPLATE_REGISTRY = createTemplateRegistry([
  SERVICE_PROJECT_QUOTE_REGISTRATION,
  OEM_CUSTOM_QUOTE_REGISTRATION,
  EXPORT_BILINGUAL_QUOTE_REGISTRATION,
  PROFORMA_INVOICE_REGISTRATION,
  DOMESTIC_SALE_CONTRACT_REGISTRATION,
  FRAMEWORK_SUPPLY_CONTRACT_REGISTRATION,
  OEM_PROCESSING_CONTRACT_REGISTRATION,
]);
