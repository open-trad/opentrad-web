import { hardenWorkerValue } from "./manifest.js";

export const LIBRARY_POLICY = hardenWorkerValue({
  sheetjs: {
    id: "sheetjs" as const,
    package: "xlsx" as const,
    version: "0.20.3" as const,
    source: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz" as const,
    integrity:
      "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==" as const,
    license: "Apache-2.0" as const,
    network: "none" as const,
  },
});
