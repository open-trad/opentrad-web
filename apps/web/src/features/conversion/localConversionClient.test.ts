import { readFileSync } from "node:fs";
import { CAPABILITIES } from "@opentrad/contracts";
import { describe, expect, it, vi } from "vitest";

const validationMock = vi.hoisted(() => ({
  validate: vi.fn(
    async (bytes: unknown, _format: unknown, _signal: unknown) => bytes as Uint8Array<ArrayBuffer>,
  ),
}));

vi.mock("@opentrad/conversion-local/validation", () => ({
  validateLocalOutput: validationMock.validate,
}));

import {
  LOCAL_BROWSER_CAPABILITIES,
  type LocalConversionRuntime,
  runLocalConversion,
} from "./localConversionClient";

function localFile(name: string, bytes: Uint8Array<ArrayBuffer>): File {
  const file = new File([bytes], name, { type: "application/octet-stream" });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn(async () => bytes.slice().buffer),
  });
  return file;
}

function runtime(
  output = new Uint8Array([1, 2, 3]),
  mediaType = "application/pdf",
): LocalConversionRuntime {
  return {
    inspectPdf: vi.fn(async () => ({ pageCount: 2 })),
    readFile: vi.fn(async (file: File) => new Uint8Array(await file.arrayBuffer())),
    run: vi.fn(async (request) => ({
      bytes: output,
      id: (request as { readonly id: string }).id,
      mediaType,
      ok: true as const,
    })),
  };
}

describe("Web local conversion orchestration", () => {
  it("keeps heavy PDF and output validators behind operation-time dynamic imports", () => {
    const source = readFileSync("src/features/conversion/localConversionClient.ts", "utf8");
    expect(source).not.toMatch(
      /^import[\s\S]*?from\s+["']@opentrad\/conversion-local\/(pdf|validation)["']/mu,
    );
    expect(source).not.toMatch(/^import\s+["']@opentrad\/conversion-local\/(pdf|validation)["']/mu);
    expect(source).toContain('await import("@opentrad/conversion-local/validation")');
  });

  it("routes every conversion operation through the disposable worker client", () => {
    const source = readFileSync("src/features/conversion/localConversionClient.ts", "utf8");
    expect(source).not.toContain('import("@opentrad/conversion-local/text")');
    expect(source).not.toContain('import("@opentrad/conversion-local/document")');
    expect(source).not.toContain('import("@opentrad/conversion-local/pdf-transform")');
    expect(source).not.toContain('import("@opentrad/conversion-local/pdf")');
    expect(source).toMatch(/run:\s*\(request[^=]*=>\s*client\.run\(request, signal\)/u);
  });

  it("keeps local orchestration and its worker free of network primitives", () => {
    const sources = [
      readFileSync("src/features/conversion/localConversionClient.ts", "utf8"),
      readFileSync("src/features/conversion/localConversion.worker.ts", "utf8"),
    ].join("\n");
    expect(sources).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b/u);
  });

  it("derives exactly the seven browser capabilities from contracts", () => {
    expect(LOCAL_BROWSER_CAPABILITIES.map((item) => item.id)).toEqual(
      CAPABILITIES.filter((item) => item.execution === "browser").map((item) => item.id),
    );
    expect(LOCAL_BROWSER_CAPABILITIES).toHaveLength(7);
  });

  it("builds an exact single-file request only after invocation", async () => {
    const services = runtime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    const file = localFile("local.txt", new TextEncoder().encode("OpenTrad"));
    const controller = new AbortController();
    expect(file.arrayBuffer).not.toHaveBeenCalled();

    const result = await runLocalConversion(
      { files: [file], operation: "document.generate", outputFormat: "pdf" },
      services,
      controller.signal,
    );

    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(services.run).toHaveBeenCalledWith(
      {
        bytes: expect.any(Uint8Array),
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        inputFormat: "txt",
        operation: "document.generate",
        options: { encoding: "utf-8" },
        outputFormat: "pdf",
      },
      expect.any(AbortSignal),
    );
    expect(new TextDecoder("latin1").decode(result.bytes)).toBe("%PDF-");
    expect(result.downloadName).toBe("opentrad-local-document-generate.pdf");
    const validationCall = validationMock.validate.mock.calls.at(-1);
    expect(Array.from(validationCall?.[0] as Uint8Array)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(validationCall?.[1]).toBe("pdf");
    expect(validationCall?.[2]).toBe(controller.signal);
  });

  it("delegates complete PDF merge planning to the disposable worker", async () => {
    const services = runtime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    const files = [
      localFile("one.pdf", new Uint8Array([1])),
      localFile("two.pdf", new Uint8Array([2])),
    ];

    await runLocalConversion(
      { files, operation: "pdf.organize", outputFormat: "pdf" },
      services,
      new AbortController().signal,
    );

    expect(services.inspectPdf).not.toHaveBeenCalled();
    expect(services.run).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          { bytes: expect.any(Uint8Array), inputFormat: "pdf" },
          { bytes: expect.any(Uint8Array), inputFormat: "pdf" },
        ],
        kind: "aggregate",
        operation: "pdf.organize",
        options: {},
      }),
      expect.any(AbortSignal),
    );
  });

  it("rejects unknown pairs and limits before reading file bytes", async () => {
    const services = runtime(new Uint8Array([1, 2, 3]), "text/markdown");
    const file = localFile("private.exe", new Uint8Array([1]));

    await expect(
      runLocalConversion(
        { files: [file], operation: "text.semantic", outputFormat: "pdf" },
        services,
        new AbortController().signal,
      ),
    ).rejects.toThrow("LOCAL_SELECTION_INVALID");
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(services.run).not.toHaveBeenCalled();
  });

  it.each([
    [
      "text.semantic",
      "safe.txt",
      "md",
      Uint8Array.from(new TextEncoder().encode("# local")),
      "text/markdown",
    ],
    [
      "docx.extract",
      "safe.docx",
      "txt",
      Uint8Array.from(new TextEncoder().encode("local")),
      "text/plain",
    ],
    [
      "pdf.inspect",
      "safe.pdf",
      "txt",
      Uint8Array.from(new TextEncoder().encode("local")),
      "text/plain",
    ],
    [
      "image.convert",
      "safe.jpg",
      "png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ],
    [
      "images.to.pdf",
      "safe.png",
      "pdf",
      Uint8Array.from(new TextEncoder().encode("%PDF-")),
      "application/pdf",
    ],
  ] as const)(
    "runs %s through its exact local request",
    async (operation, name, outputFormat, output, mediaType) => {
      const services = runtime(output, mediaType);
      await expect(
        runLocalConversion(
          { files: [localFile(name, new Uint8Array([1]))], operation, outputFormat },
          services,
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ mediaType, outputFormat });
      expect(services.run).toHaveBeenCalledWith(
        expect.objectContaining({ operation, outputFormat }),
        expect.any(AbortSignal),
      );
    },
  );

  it("rejects mismatched response media before a download can be created", async () => {
    const services = runtime(new TextEncoder().encode("safe"), "application/pdf");
    await expect(
      runLocalConversion(
        {
          files: [localFile("safe.txt", new Uint8Array([1]))],
          operation: "text.semantic",
          outputFormat: "txt",
        },
        services,
        new AbortController().signal,
      ),
    ).rejects.toThrow("LOCAL_RESULT_INVALID");
  });

  it("rejects accessor and revoked top-level selections without invoking them", async () => {
    const services = runtime();
    let getterCalls = 0;
    const hostile = {
      files: [localFile("safe.txt", new Uint8Array([1]))],
      outputFormat: "md",
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "operation", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "text.semantic";
      },
    });

    await expect(
      runLocalConversion(hostile as never, services, new AbortController().signal),
    ).rejects.toThrow("LOCAL_SELECTION_INVALID");
    expect(getterCalls).toBe(0);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    await expect(
      runLocalConversion(proxy as never, services, new AbortController().signal),
    ).rejects.toThrow("LOCAL_SELECTION_INVALID");
    expect(services.run).not.toHaveBeenCalled();
  });

  it("rejects nested file accessors without invoking them", async () => {
    const services = runtime();
    const files: File[] = [];
    let getterCalls = 0;
    Object.defineProperty(files, "0", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return localFile("safe.txt", new Uint8Array([1]));
      },
    });
    Object.defineProperty(files, "length", { value: 1 });

    await expect(
      runLocalConversion(
        { files, operation: "text.semantic", outputFormat: "md" },
        services,
        new AbortController().signal,
      ),
    ).rejects.toThrow("LOCAL_SELECTION_INVALID");
    expect(getterCalls).toBe(0);
    expect(services.run).not.toHaveBeenCalled();
  });

  it("uses intrinsic File metadata without invoking hostile own accessors", async () => {
    const services = runtime(new Uint8Array([1, 2, 3]), "text/markdown");
    let getterCalls = 0;
    const hostileFile = localFile("safe.txt", new Uint8Array([1]));
    for (const property of ["name", "size", "payload"]) {
      Object.defineProperty(hostileFile, property, {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          return "private";
        },
      });
    }

    await expect(
      runLocalConversion(
        { files: [hostileFile], operation: "text.semantic", outputFormat: "md" },
        services,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ outputFormat: "md" });
    expect(getterCalls).toBe(0);
    expect(services.run).toHaveBeenCalledTimes(1);
  });

  it("rejects hostile runtime response accessors without invoking them", async () => {
    let getterCalls = 0;
    const services = runtime(new TextEncoder().encode("safe"), "text/plain");
    services.run = vi.fn(async (request) => {
      const response = {
        bytes: new TextEncoder().encode("safe"),
        id: (request as { readonly id: string }).id,
        ok: true,
      } as Record<string, unknown>;
      Object.defineProperty(response, "mediaType", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "text/plain";
        },
      });
      return response as never;
    });

    await expect(
      runLocalConversion(
        {
          files: [localFile("safe.txt", new Uint8Array([1]))],
          operation: "text.semantic",
          outputFormat: "txt",
        },
        services,
        new AbortController().signal,
      ),
    ).rejects.toThrow("LOCAL_RESULT_INVALID");
    expect(getterCalls).toBe(0);
  });

  it("rejects a real typed array with hostile own accessors without invoking them", async () => {
    let getterCalls = 0;
    const services = runtime(new TextEncoder().encode("safe"), "text/plain");
    services.run = vi.fn(async (request) => {
      const bytes = new TextEncoder().encode("safe");
      for (const property of ["buffer", "byteLength", "payload"]) {
        Object.defineProperty(bytes, property, {
          configurable: true,
          enumerable: true,
          get() {
            getterCalls += 1;
            return "private";
          },
        });
      }
      return {
        bytes,
        id: (request as { readonly id: string }).id,
        mediaType: "text/plain",
        ok: true,
      };
    });

    await expect(
      runLocalConversion(
        {
          files: [localFile("safe.txt", new Uint8Array([1]))],
          operation: "text.semantic",
          outputFormat: "txt",
        },
        services,
        new AbortController().signal,
      ),
    ).rejects.toThrow("LOCAL_RESULT_INVALID");
    expect(getterCalls).toBe(0);
  });
});
