import { CAPABILITIES, type ConversionCapability } from "@opentrad/contracts";
import { describe, expect, it } from "vitest";
import {
  resolveCommandPolicy,
  SERVER_OPERATION_IDS,
  type WorkerCommandPolicy,
} from "../src/commandPolicy.js";
import { TOOLCHAIN_POLICY } from "../src/toolchain.js";

const expectedTools = {
  libreoffice: { executable: "/usr/bin/soffice", version: "26.2.5" },
  ocrmypdf: { executable: "/opt/ocr/bin/ocrmypdf", version: "17.10.0" },
  pandoc: { executable: "/usr/bin/pandoc", version: "3.10.2" },
  pdfinfo: { executable: "/usr/bin/pdfinfo", version: "26.08.0" },
  pdftoppm: { executable: "/usr/bin/pdftoppm", version: "26.08.0" },
  pdftotext: { executable: "/usr/bin/pdftotext", version: "26.08.0" },
  qpdf: { executable: "/usr/bin/qpdf", version: "12.4.0" },
  tesseract: { executable: "/usr/bin/tesseract", version: "5.5.3" },
  vips: { executable: "/usr/bin/vips", version: "8.18.5" },
};

const defaultOptions = (id: string): Record<string, unknown> => {
  if (id === "bid.assemble") {
    return { templateId: "bid.government.goods.v1", templateVersion: "1.0.0" };
  }
  return {};
};

function request(capability: ConversionCapability, inputFormat: string, outputFormat: string) {
  return {
    operation: capability.id,
    inputFormat,
    outputFormat,
    inputBytes: 1,
    options: defaultOptions(capability.id),
  };
}

function expectHardened(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value)).toBe(Array.prototype);
    for (const entry of value) expectHardened(entry);
    return;
  }
  expect(Object.getPrototypeOf(value)).toBeNull();
  for (const entry of Object.values(value)) expectHardened(entry);
}

describe("fixed worker allowlist", () => {
  it("covers exactly the 9 server capabilities and all 66 contract pairs", () => {
    expect(CAPABILITIES).toHaveLength(16);
    const browser = CAPABILITIES.filter((capability) => capability.execution === "browser");
    const server = CAPABILITIES.filter((capability) => capability.execution === "server");
    expect(browser).toHaveLength(7);
    expect(server).toHaveLength(9);
    expect([...SERVER_OPERATION_IDS]).toEqual(server.map(({ id }) => id));

    let pairs = 0;
    for (const capability of server) {
      for (const inputFormat of capability.inputFormats) {
        for (const outputFormat of capability.outputFormats) {
          const policy = resolveCommandPolicy(request(capability, inputFormat, outputFormat));
          expect(policy.operation).toBe(capability.id);
          expect(policy.inputFormat).toBe(inputFormat);
          expect(policy.outputFormat).toBe(outputFormat);
          expect(policy.shell).toBe(false);
          expect(policy.network).toBe("none");
          expect(policy.pathDiscovery).toBe(false);
          pairs += 1;
        }
      }
    }
    expect(pairs).toBe(66);
  });

  it("rejects every browser-local capability instead of uploading it", () => {
    const browser = CAPABILITIES.filter((capability) => capability.execution === "browser");
    for (const capability of browser) {
      expect(() =>
        resolveCommandPolicy(
          request(
            capability,
            capability.inputFormats[0] ?? "txt",
            capability.outputFormats[0] ?? "txt",
          ),
        ),
      ).toThrow("Unsupported worker command");
    }
  });

  it("pins an absolute, versioned, serializable and deeply immutable toolchain", () => {
    expect(TOOLCHAIN_POLICY).toEqual({
      network: "none",
      pathDiscovery: false,
      shell: false,
      tools: expectedTools,
    });
    expect(JSON.parse(JSON.stringify(TOOLCHAIN_POLICY))).toEqual(TOOLCHAIN_POLICY);
    expectHardened(TOOLCHAIN_POLICY);
    for (const tool of Object.values(TOOLCHAIN_POLICY.tools)) {
      expect(tool.executable.startsWith("/")).toBe(true);
    }
  });

  it("uses only pinned tool references and fixed adapters, never caller argv", () => {
    const server = CAPABILITIES.filter((capability) => capability.execution === "server");
    const allowedTools = new Set(Object.keys(expectedTools));
    const allowedAdapters = new Set([
      "bid-assembly",
      "image-convert",
      "office-convert",
      "ocr-image",
      "ocr-pdf",
      "pdf-repair",
      "pdf-text-to-docx",
      "spreadsheet-to-csv",
      "structured-convert",
    ]);
    for (const capability of server) {
      const policy: WorkerCommandPolicy = resolveCommandPolicy(
        request(
          capability,
          capability.inputFormats[0] ?? "docx",
          capability.outputFormats[0] ?? "pdf",
        ),
      );
      expect(allowedAdapters.has(policy.adapter)).toBe(true);
      if (capability.id === "spreadsheet.to.csv") expect(policy.tools).toEqual([]);
      else expect(policy.tools.length).toBeGreaterThan(0);
      expect(policy.tools.every((tool) => allowedTools.has(tool))).toBe(true);
      expect("argv" in policy).toBe(false);
      expect("command" in policy).toBe(false);
      expectHardened(policy);
    }
  });

  it("models sheetIndex only as a schema-bounded adapter parameter", () => {
    const policy = resolveCommandPolicy({
      operation: "spreadsheet.to.csv",
      inputFormat: "xlsx",
      outputFormat: "csv",
      inputBytes: 12,
      options: { sheetIndex: 7 },
    });

    expect(policy.parameters).toEqual({ sheetIndex: 7 });
    expect(policy.tools).toEqual([]);
    expect(() =>
      resolveCommandPolicy({
        operation: "spreadsheet.to.csv",
        inputFormat: "xlsx",
        outputFormat: "csv",
        inputBytes: 12,
        options: { sheetIndex: "7; touch /tmp/pwned" },
      }),
    ).toThrow("Unsupported worker command");
  });

  it("rejects transparent proxies at the command-policy boundary", () => {
    const valid = {
      operation: "office.to.pdf",
      inputFormat: "docx",
      outputFormat: "pdf",
      inputBytes: 12,
      options: {},
    };

    expect(() => resolveCommandPolicy(new Proxy(valid, {}))).toThrow("Unsupported worker command");
    expect(() => resolveCommandPolicy({ ...valid, options: new Proxy({}, {}) })).toThrow(
      "Unsupported worker command",
    );
  });

  it("keeps structured identity pairs because the authoritative request schema permits them", () => {
    expect(
      resolveCommandPolicy({
        operation: "structured.convert",
        inputFormat: "docx",
        outputFormat: "docx",
        inputBytes: 1,
        options: {},
      }).adapter,
    ).toBe("structured-convert");
  });

  it("declares the exact renderer and LO validation union, adding qpdf only for PDF", () => {
    const base = {
      operation: "bid.assemble",
      inputFormat: "opentrad",
      inputBytes: 1,
      options: { templateId: "bid.government.goods.v1", templateVersion: "1.0.0" },
    } as const;
    expect(resolveCommandPolicy({ ...base, outputFormat: "docx" }).tools).toEqual([
      "pdfinfo",
      "pdftoppm",
      "vips",
      "libreoffice",
    ]);
    expect(resolveCommandPolicy({ ...base, outputFormat: "pdf" }).tools).toEqual([
      "pdfinfo",
      "pdftoppm",
      "vips",
      "libreoffice",
      "qpdf",
    ]);
  });
});
