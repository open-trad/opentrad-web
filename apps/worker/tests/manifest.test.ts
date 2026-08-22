import { describe, expect, it } from "vitest";
import { parseWorkerManifest } from "../src/manifest.js";

const jobId = "123e4567-e89b-42d3-a456-426614174000";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "server-v1",
    jobId,
    operation: "office.to.pdf",
    inputFormat: "docx",
    outputFormat: "pdf",
    options: {},
    inputBytes: 12,
    ...overrides,
  };
}

describe("worker manifest", () => {
  it("parses the exact Task 8 server-v1 handoff and returns hardened data", () => {
    const parsed = parseWorkerManifest(manifest());

    expect(parsed).toEqual(manifest());
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(parsed.options)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.options)).toBe(true);
  });

  it.each([
    ["unknown field", manifest({ extra: true })],
    ["wrong schema", manifest({ schemaVersion: "server-v2" })],
    ["invalid job id", manifest({ jobId: "../running" })],
    ["non-finite bytes", manifest({ inputBytes: Number.POSITIVE_INFINITY })],
    ["wrong option", manifest({ options: { language: "eng" } })],
    ["wrong pair", manifest({ outputFormat: "docx" })],
  ])("rejects %s", (_label, input) => {
    expect(() => parseWorkerManifest(input)).toThrow("Invalid worker manifest");
  });

  it("rejects accessors without invoking them", () => {
    let reads = 0;
    const input = manifest();
    Object.defineProperty(input, "operation", {
      enumerable: true,
      get() {
        reads += 1;
        return "office.to.pdf";
      },
    });

    expect(() => parseWorkerManifest(input)).toThrow("Invalid worker manifest");
    expect(reads).toBe(0);
  });

  it("rejects proxies and objects with polluted prototypes fail-closed", () => {
    const transparentProxy = new Proxy(manifest(), {});
    const throwingProxy = new Proxy(manifest(), {
      ownKeys() {
        throw new Error("trap");
      },
    });
    const nestedProxy = manifest({ options: new Proxy({}, {}) });
    const polluted = Object.assign(Object.create({ operation: "office.to.pdf" }), manifest());

    expect(() => parseWorkerManifest(transparentProxy)).toThrow("Invalid worker manifest");
    expect(() => parseWorkerManifest(throwingProxy)).toThrow("Invalid worker manifest");
    expect(() => parseWorkerManifest(nestedProxy)).toThrow("Invalid worker manifest");
    expect(() => parseWorkerManifest(polluted)).toThrow("Invalid worker manifest");
  });

  it("enforces operation-specific exact options", () => {
    expect(
      parseWorkerManifest(
        manifest({
          operation: "spreadsheet.to.csv",
          inputFormat: "xlsx",
          outputFormat: "csv",
          options: { sheetIndex: 255 },
        }),
      ).options,
    ).toEqual({ sheetIndex: 255 });
    expect(() =>
      parseWorkerManifest(
        manifest({
          operation: "spreadsheet.to.csv",
          inputFormat: "xlsx",
          outputFormat: "csv",
          options: { sheetIndex: 256 },
        }),
      ),
    ).toThrow("Invalid worker manifest");
    expect(
      parseWorkerManifest(
        manifest({
          operation: "bid.assemble",
          inputFormat: "opentrad",
          outputFormat: "pdf",
          options: {
            templateId: "bid.government.goods.v1",
            templateVersion: "1.0.0",
          },
          inputBytes: 52 * 1024 * 1024,
        }),
      ).operation,
    ).toBe("bid.assemble");
  });
});
