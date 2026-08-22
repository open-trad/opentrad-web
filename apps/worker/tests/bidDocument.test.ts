import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { inspectBidAttachmentBytes } from "../src/adapters/bidAttachmentInspector.js";
import {
  assembleBidJob,
  createBidAssemblyRuntime,
  createBidAssemblyRuntimeForTesting,
} from "../src/policies/bidAssembly.js";
import { compileCanonicalBidProject, createBidCompileRuntime } from "../src/policies/bidCompile.js";
import {
  copyRenderedBidDocumentBytes,
  renderCompiledBidDocument,
} from "../src/policies/bidDocument.js";
import {
  copyFinalizedBidResultBytes,
  createBidFinalizeFileRuntimeForTesting,
  createBidFinalizeRuntime,
  createBidFinalizeRuntimeForTesting,
  finalizeRenderedBidDocument,
} from "../src/policies/bidFinalize.js";
import {
  createBidHandoffFileRuntimeForTesting,
  createBidHandoffRuntime,
  createBidHandoffRuntimeForTesting,
  handoffFinalizedBidResult,
} from "../src/policies/bidHandoff.js";

const REAL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2vwP4V0658FeH53XDS6fbuf3UTcmNT1KEn6kk0UUV01Mny+Um3Qg2/wC7H/I+BxdSf1ipr1f5n//Z";
const JPEG = Uint8Array.from(Buffer.from(REAL_JPEG_BASE64, "base64"));

async function snapshot() {
  const draft = JSON.parse(
    await readFile(
      new URL(
        "../../../packages/document-core/tests/fixtures/v2/bid-government-goods.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const attachments = (draft.attachments as Array<Record<string, unknown>>).map(
    ({ localBlobKey: _localBlobKey, ...attachment }) => attachment,
  );
  const envelope = {
    formatVersion: "2.0.0",
    template: {
      id: "bid.government.goods.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft,
    presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
    attachmentManifest: attachments,
  };
  const stableJson = (value: unknown): string => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return JSON.stringify(value);
    }
    if (typeof value === "number") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  };
  const result = compileCanonicalBidProject(
    new TextEncoder().encode(stableJson(envelope)),
    { templateId: "bid.government.goods.v1", templateVersion: "1.0.0" },
    createBidCompileRuntime({ now: () => Date.parse("2026-08-20T04:00:00.000Z") }),
  );
  const expectedModel = JSON.parse(
    await readFile(
      new URL(
        "../../../tests/golds/templates-v2/artifacts/bid.government.goods.v1/default.model.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(result.model).toEqual(expectedModel);
  expect(Object.getPrototypeOf(result)).toBeNull();
  return result;
}

function attachmentPages() {
  return [
    {
      attachmentId: "proof-license",
      pageNumber: 1,
      bytes: JPEG.slice(),
      widthPixels: 2,
      heightPixels: 4,
    },
    ...Array.from({ length: 8 }, (_value, index) => ({
      attachmentId: "proof-spec",
      pageNumber: index + 1,
      bytes: JPEG.slice(),
      widthPixels: 2,
      heightPixels: 4,
    })),
  ];
}

async function pdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([595.28, 841.89]);
  return document.save({ useObjectStreams: true });
}

async function finalizeRuntime(
  pageCount: number,
  mode: "success" | "failure" | "never" = "success",
) {
  const files = new Map<string, Uint8Array>();
  const commands: Array<{ readonly argv: readonly string[]; readonly executable: string }> = [];
  const validationPdf = await pdf(pageCount);
  const runtime = createBidFinalizeRuntimeForTesting({
    inspectPdf: async (
      bytes: Uint8Array,
      maximumPages: number,
      signal: AbortSignal,
      deadline: number,
    ) => inspectBidAttachmentBytes(bytes, "application/pdf", maximumPages, signal, deadline),
    now: Date.now,
    read: async (path: string) => files.get(path)?.slice(),
    remove: async (path: string) => {
      files.delete(path);
    },
    removeTree: async (path: string) => {
      for (const key of files.keys()) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    run: async (spec: { readonly argv: readonly string[]; readonly executable: string }) => {
      commands.push(spec);
      if (spec.executable.endsWith("soffice")) {
        files.set(`${spec.argv[spec.argv.length - 2]}/body.pdf`, validationPdf.slice());
        const profileArgument = spec.argv.find((value) =>
          value.startsWith("-env:UserInstallation=file://"),
        );
        if (profileArgument) {
          files.set(
            `${profileArgument.slice("-env:UserInstallation=file://".length)}/registrymodifications.xcu`,
            Uint8Array.of(1),
          );
        }
        if (mode === "failure") throw new Error("PRIVATE_LO_FAILURE");
        if (mode === "never") return new Promise<void>(() => undefined);
      } else if (spec.executable.endsWith("qpdf") && spec.argv[0] !== "--check") {
        const output = spec.argv[spec.argv.length - 1];
        if (output) files.set(output, validationPdf.slice());
      }
    },
    write: async (path: string, bytes: Uint8Array) => {
      files.set(path, bytes.slice());
    },
  });
  return { commands, files, runtime };
}

describe("compiled bid document renderer", () => {
  it("renders the real compiled model and ordered raster overlay through the shared renderer", async () => {
    const result = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    expect(result).toEqual({
      attachmentPages: 9,
      byteLength: expect.any(Number),
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      schemaVersion: "bid-rendered-document-v1",
    });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);

    const first = copyRenderedBidDocumentBytes(result);
    expect(Array.from(first.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    first[0] = 0;
    expect(copyRenderedBidDocumentBytes(result)[0]).toBe(0x50);
  }, 20_000);

  it("rejects forged snapshots and hostile raster containers with one fixed error", async () => {
    const valid = await snapshot();
    const plain = { ...valid };
    const nullPrototype = Object.assign(Object.create(null), plain);
    for (const forged of [plain, nullPrototype, { ...plain, extra: true }, new Proxy(valid, {})]) {
      await expect(renderCompiledBidDocument(forged, attachmentPages())).rejects.toThrow(
        "CONVERSION_FAILED",
      );
    }
    await expect(
      renderCompiledBidDocument(valid, new Proxy(attachmentPages(), {})),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(() => copyRenderedBidDocumentBytes({ ...valid })).toThrow("CONVERSION_FAILED");
  });

  it("recomputes body pages through LibreOffice before returning the original DOCX", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const original = copyRenderedBidDocumentBytes(rendered);
    const { commands, files, runtime } = await finalizeRuntime(10);
    const result = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      undefined,
      runtime,
    );
    expect(result).toEqual({
      attachmentPages: 9,
      bodyPages: 1,
      byteLength: original.byteLength,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pageCount: 10,
      schemaVersion: "bid-finalized-result-v1",
    });
    expect(copyFinalizedBidResultBytes(result)).toEqual(original);
    expect(commands.map((command) => command.executable)).toEqual([
      "/usr/bin/soffice",
      "/usr/bin/pdfinfo",
    ]);
    expect(files.size).toBe(0);
  }, 20_000);

  it("canonicalizes PDF output through qpdf and verifies the final artifact", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const { commands, runtime } = await finalizeRuntime(10);
    const result = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "pdf",
      undefined,
      runtime,
    );
    const bytes = copyFinalizedBidResultBytes(result);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    bytes[0] = 0;
    expect(copyFinalizedBidResultBytes(result)[0]).toBe(0x25);
    expect(result).toMatchObject({ bodyPages: 1, pageCount: 10, mediaType: "application/pdf" });
    expect(commands.map((command) => command.executable)).toEqual([
      "/usr/bin/soffice",
      "/usr/bin/pdfinfo",
      "/usr/bin/qpdf",
      "/usr/bin/qpdf",
      "/usr/bin/pdfinfo",
    ]);
  }, 20_000);

  it("rejects zero-body and over-limit actual page counts with fixed cleanup", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    for (const pageCount of [9, 81]) {
      const { files, runtime } = await finalizeRuntime(pageCount);
      await expect(
        finalizeRenderedBidDocument(
          rendered,
          "123e4567-e89b-42d3-a456-426614174000",
          "docx",
          undefined,
          runtime,
        ),
      ).rejects.toThrow("CONVERSION_FAILED");
      expect(files.size).toBe(0);
    }
  }, 20_000);

  it("cleans the LibreOffice profile on failure, abort and a non-settling tool", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const failure = await finalizeRuntime(10, "failure");
    await expect(
      finalizeRenderedBidDocument(
        rendered,
        "123e4567-e89b-42d3-a456-426614174000",
        "docx",
        undefined,
        failure.runtime,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(failure.files.size).toBe(0);

    const never = await finalizeRuntime(10, "never");
    const controller = new AbortController();
    const pending = finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      controller.signal,
      never.runtime,
    );
    setImmediate(() => controller.abort());
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 4_000)),
    ]);
    expect(outcome).toBe("rejected");
    expect(never.files.size).toBe(0);
  }, 20_000);

  it("keeps the production finalizer runtime fixed and rejects linked workspace parents", async () => {
    expect(Object.isFrozen(createBidFinalizeRuntime())).toBe(true);
    expect(() => createBidFinalizeRuntime({ fetch: globalThis.fetch })).toThrow(
      "CONVERSION_FAILED",
    );

    const root = await mkdtemp(join(tmpdir(), "opentrad-finalize-root-"));
    const redirect = await mkdtemp(join(tmpdir(), "opentrad-finalize-redirect-"));
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const jobDirectory = join(root, jobId);
    const linkedBid = join(jobDirectory, "bid");
    try {
      await mkdir(jobDirectory, { mode: 0o700 });
      await symlink(redirect, linkedBid);
      const runtime = createBidFinalizeFileRuntimeForTesting(root);
      await expect(
        runtime.write(join(linkedBid, "body.docx"), Uint8Array.of(0x50, 0x4b, 3, 4)),
      ).rejects.toThrow("CONVERSION_FAILED");
      await expect(readFile(join(redirect, "body.docx"))).rejects.toThrow();

      await rm(linkedBid);
      await mkdir(linkedBid, { mode: 0o700 });
      const linkedProfile = join(linkedBid, "libreoffice-profile");
      await writeFile(join(redirect, "registrymodifications.xcu"), "PRIVATE", { mode: 0o600 });
      await symlink(redirect, linkedProfile);
      await expect(runtime.removeTree(linkedProfile)).rejects.toThrow("CONVERSION_FAILED");
      await expect(readFile(join(redirect, "registrymodifications.xcu"), "utf8")).resolves.toBe(
        "PRIVATE",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(redirect, { recursive: true, force: true });
    }
  });

  it("chains the exact bid manifest through parse, compile, raster, render and finalize", async () => {
    const calls: string[] = [];
    const compileSnapshot = await snapshot();
    const images = attachmentPages();
    const finalize = await finalizeRuntime(10);
    const runtime = createBidAssemblyRuntimeForTesting({
      compile: async (archive: unknown, options: unknown) => {
        expect(archive).toEqual({ canonical: true });
        expect(options).toEqual({
          templateId: "bid.government.goods.v1",
          templateVersion: "1.0.0",
        });
        calls.push("compile");
        return compileSnapshot;
      },
      finalize: async (rendered: unknown, jobId: string, outputFormat: string) => {
        calls.push("finalize");
        return finalizeRenderedBidDocument(
          rendered as never,
          jobId,
          outputFormat as "docx",
          undefined,
          finalize.runtime,
        );
      },
      now: Date.now,
      parse: async (bytes: Uint8Array, options: unknown) => {
        expect(Array.from(bytes)).toEqual([1, 2, 3]);
        bytes[0] = 99;
        expect(options).toEqual({
          templateId: "bid.government.goods.v1",
          templateVersion: "1.0.0",
        });
        calls.push("parse");
        return { canonical: true };
      },
      raster: async () => {
        calls.push("raster");
        return images;
      },
      render: async (compiled: unknown, raster: unknown) => {
        expect(compiled).toBe(compileSnapshot);
        expect(raster).toBe(images);
        calls.push("render");
        return renderCompiledBidDocument(compiled, raster);
      },
    });
    const input = Uint8Array.of(1, 2, 3);
    const result = await assembleBidJob(
      input,
      {
        schemaVersion: "server-v1",
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        operation: "bid.assemble",
        inputFormat: "opentrad",
        outputFormat: "docx",
        inputBytes: 3,
        options: {
          templateId: "bid.government.goods.v1",
          templateVersion: "1.0.0",
        },
      },
      undefined,
      runtime,
    );
    expect(calls).toEqual(["parse", "compile", "raster", "render", "finalize"]);
    expect(input).toEqual(Uint8Array.of(1, 2, 3));
    expect(copyFinalizedBidResultBytes(result)[0]).toBe(0x50);
  }, 20_000);

  it("rejects non-bid manifests and byte mismatches before invoking the assembly runtime", async () => {
    const call = vi.fn();
    const runtime = createBidAssemblyRuntimeForTesting({
      compile: call,
      finalize: call,
      now: Date.now,
      parse: call,
      raster: call,
      render: call,
    });
    await expect(
      assembleBidJob(
        Uint8Array.of(1),
        {
          schemaVersion: "server-v1",
          jobId: "123e4567-e89b-42d3-a456-426614174000",
          operation: "pdf.repair",
          inputFormat: "pdf",
          outputFormat: "pdf",
          inputBytes: 1,
          options: {},
        },
        undefined,
        runtime,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    await expect(
      assembleBidJob(
        Uint8Array.of(1),
        {
          schemaVersion: "server-v1",
          jobId: "123e4567-e89b-42d3-a456-426614174000",
          operation: "bid.assemble",
          inputFormat: "opentrad",
          outputFormat: "pdf",
          inputBytes: 2,
          options: {
            templateId: "bid.government.goods.v1",
            templateVersion: "1.0.0",
          },
        },
        undefined,
        runtime,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(call).not.toHaveBeenCalled();
    expect(Object.isFrozen(createBidAssemblyRuntime())).toBe(true);
    expect(() => createBidAssemblyRuntime({ extra: true })).toThrow("CONVERSION_FAILED");
  });

  it("uses one trusted 300-second clock across every assembly stage", async () => {
    let now = 0;
    const calls: string[] = [];
    const runtime = createBidAssemblyRuntimeForTesting({
      compile: async () => {
        calls.push("compile");
        now = 200_000;
        return Object.create(null);
      },
      finalize: async () => {
        calls.push("finalize");
        throw new Error("must not finalize");
      },
      now: () => now,
      parse: async () => {
        calls.push("parse");
        now = 100_000;
        return Object.create(null);
      },
      raster: async () => {
        calls.push("raster");
        now = 299_000;
        return [];
      },
      render: async () => {
        calls.push("render");
        now = 300_000;
        return Object.create(null);
      },
    });
    await expect(
      assembleBidJob(
        Uint8Array.of(1),
        {
          schemaVersion: "server-v1",
          jobId: "123e4567-e89b-42d3-a456-426614174000",
          operation: "bid.assemble",
          inputFormat: "opentrad",
          outputFormat: "docx",
          inputBytes: 1,
          options: {
            templateId: "bid.government.goods.v1",
            templateVersion: "1.0.0",
          },
        },
        undefined,
        runtime,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(calls).toEqual(["parse", "compile", "raster", "render"]);
  });

  it("allows the pipeline to finish one millisecond before the shared deadline", async () => {
    const compiled = await snapshot();
    const images = attachmentPages();
    const rendered = await renderCompiledBidDocument(compiled, images);
    const finalizer = await finalizeRuntime(10);
    const finalized = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      undefined,
      finalizer.runtime,
    );
    let now = 0;
    const runtime = createBidAssemblyRuntimeForTesting({
      compile: async () => {
        now = 200_000;
        return compiled;
      },
      finalize: async () => finalized,
      now: () => now,
      parse: async () => {
        now = 100_000;
        return Object.create(null);
      },
      raster: async () => {
        now = 250_000;
        return images;
      },
      render: async () => {
        now = 299_999;
        return rendered;
      },
    });
    await expect(
      assembleBidJob(
        Uint8Array.of(1),
        {
          schemaVersion: "server-v1",
          jobId: "123e4567-e89b-42d3-a456-426614174000",
          operation: "bid.assemble",
          inputFormat: "opentrad",
          outputFormat: "docx",
          inputBytes: 1,
          options: {
            templateId: "bid.government.goods.v1",
            templateVersion: "1.0.0",
          },
        },
        undefined,
        runtime,
      ),
    ).resolves.toBe(finalized);
  }, 20_000);

  it("does not start finalizer file I/O at the exact absolute deadline", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const write = vi.fn(async () => undefined);
    let first = true;
    const runtime = createBidFinalizeRuntimeForTesting({
      inspectPdf: async () => ({ pageCount: 10 }),
      now: () => {
        if (first) {
          first = false;
          return 0;
        }
        return 300_000;
      },
      read: async () => Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d),
      remove: async () => undefined,
      removeTree: async () => undefined,
      run: async () => undefined,
      write,
    });
    await expect(
      finalizeRenderedBidDocument(
        rendered,
        "123e4567-e89b-42d3-a456-426614174000",
        "docx",
        undefined,
        runtime,
        300_000,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(write).not.toHaveBeenCalled();
  }, 20_000);

  it("does not eagerly start any assembly stage whose precheck reaches the deadline", async () => {
    const stageNames = ["parse", "compile", "raster", "render", "finalize"] as const;
    for (let boundaryStage = 0; boundaryStage < stageNames.length; boundaryStage += 1) {
      const calls: string[] = [];
      let clockReads = 0;
      const boundaryRead = 1 + boundaryStage * 2;
      const runtime = createBidAssemblyRuntimeForTesting({
        compile: async () => {
          calls.push("compile");
          return Object.create(null);
        },
        finalize: async () => {
          calls.push("finalize");
          return Object.create(null);
        },
        now: () => {
          const currentRead = clockReads;
          clockReads += 1;
          if (currentRead >= boundaryRead) return 300_000;
          return currentRead === boundaryRead - 1 && boundaryStage > 0 ? 299_999 : 0;
        },
        parse: async () => {
          calls.push("parse");
          return Object.create(null);
        },
        raster: async () => {
          calls.push("raster");
          return [];
        },
        render: async () => {
          calls.push("render");
          return Object.create(null);
        },
      });
      await expect(
        assembleBidJob(
          Uint8Array.of(1),
          {
            schemaVersion: "server-v1",
            jobId: "123e4567-e89b-42d3-a456-426614174000",
            operation: "bid.assemble",
            inputFormat: "opentrad",
            outputFormat: "docx",
            inputBytes: 1,
            options: {
              templateId: "bid.government.goods.v1",
              templateVersion: "1.0.0",
            },
          },
          undefined,
          runtime,
        ),
      ).rejects.toThrow("CONVERSION_FAILED");
      expect(calls).toEqual(stageNames.slice(0, boundaryStage));
    }
  });

  it("fails finitely when an assembly stage ignores caller cancellation", async () => {
    const call = vi.fn();
    const runtime = createBidAssemblyRuntimeForTesting({
      compile: call,
      finalize: call,
      now: Date.now,
      parse: async () => new Promise<never>(() => undefined),
      raster: call,
      render: call,
    });
    const controller = new AbortController();
    const pending = assembleBidJob(
      Uint8Array.of(1),
      {
        schemaVersion: "server-v1",
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        operation: "bid.assemble",
        inputFormat: "opentrad",
        outputFormat: "docx",
        inputBytes: 1,
        options: {
          templateId: "bid.government.goods.v1",
          templateVersion: "1.0.0",
        },
      },
      controller.signal,
      runtime,
    );
    controller.abort();
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 4_000)),
    ]);
    expect(outcome).toBe("rejected");
    expect(call).not.toHaveBeenCalled();
  });

  it("publishes only fixed result metadata and copied bytes through the outbox handoff", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const finalize = await finalizeRuntime(10);
    const finalized = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      undefined,
      finalize.runtime,
    );
    let published:
      | { readonly bytes: Uint8Array; readonly jobId: string; readonly status: Uint8Array }
      | undefined;
    await handoffFinalizedBidResult(
      finalized,
      "123e4567-e89b-42d3-a456-426614174000",
      createBidHandoffRuntimeForTesting({
        publish: async (jobId: string, bytes: Uint8Array, status: Uint8Array) => {
          published = { jobId, bytes, status };
          bytes[0] = 0;
        },
      }),
    );
    expect(published?.jobId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(JSON.parse(new TextDecoder().decode(published?.status))).toEqual({
      schemaVersion: "worker-result-v1",
      status: "succeeded",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      resultBytes: finalized.byteLength,
      pageCount: 10,
      bodyPages: 1,
    });
    expect(copyFinalizedBidResultBytes(finalized)[0]).toBe(0x50);
  }, 20_000);

  it("atomically moves one validated running directory to outbox without publishing done", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const finalize = await finalizeRuntime(10);
    const finalized = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      undefined,
      finalize.runtime,
    );
    const root = await mkdtemp(join(tmpdir(), "opentrad-handoff-root-"));
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const running = join(root, "running", jobId);
    const outbox = join(root, "outbox", jobId);
    try {
      await mkdir(join(root, "running"), { mode: 0o2770 });
      await mkdir(running, { mode: 0o2770 });
      await mkdir(join(root, "outbox"), { mode: 0o2770 });
      await chmod(join(root, "running"), 0o2770);
      await chmod(running, 0o2770);
      await chmod(join(root, "outbox"), 0o2770);
      await writeFile(join(running, "input.bin"), Uint8Array.of(1), { mode: 0o640 });
      await writeFile(join(running, "manifest.json"), "{}\n", { mode: 0o640 });
      await handoffFinalizedBidResult(
        finalized,
        jobId,
        createBidHandoffFileRuntimeForTesting(root, process.getgid?.() ?? 0),
      );
      await expect(readFile(join(running, "result.bin"))).rejects.toThrow();
      expect((await readFile(join(outbox, "result.bin")))[0]).toBe(0x50);
      expect(JSON.parse(await readFile(join(outbox, "status.json"), "utf8"))).toMatchObject({
        status: "succeeded",
        resultBytes: finalized.byteLength,
      });
      await expect(readFile(join(root, "done", jobId, "result.bin"))).rejects.toThrow();
      expect(Object.isFrozen(createBidHandoffRuntime())).toBe(true);
      expect(() => createBidHandoffRuntime({ root })).toThrow("CONVERSION_FAILED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects running handoff roots without setgid or with the wrong worker gid", async () => {
    const rendered = await renderCompiledBidDocument(await snapshot(), attachmentPages());
    const finalize = await finalizeRuntime(10);
    const finalized = await finalizeRenderedBidDocument(
      rendered,
      "123e4567-e89b-42d3-a456-426614174000",
      "docx",
      undefined,
      finalize.runtime,
    );
    const currentGid = process.getgid?.() ?? 0;
    for (const [setgid, expectedGid] of [
      [false, currentGid],
      [true, currentGid + 1],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), "opentrad-handoff-permissions-"));
      const jobId = "123e4567-e89b-42d3-a456-426614174000";
      const runningParent = join(root, "running");
      const running = join(runningParent, jobId);
      const outbox = join(root, "outbox");
      try {
        await mkdir(runningParent, { mode: setgid ? 0o2770 : 0o770 });
        await mkdir(running, { mode: setgid ? 0o2770 : 0o770 });
        await mkdir(outbox, { mode: setgid ? 0o2770 : 0o770 });
        await chmod(runningParent, setgid ? 0o2770 : 0o770);
        await chmod(running, setgid ? 0o2770 : 0o770);
        await chmod(outbox, setgid ? 0o2770 : 0o770);
        await writeFile(join(running, "input.bin"), Uint8Array.of(1), { mode: 0o640 });
        await writeFile(join(running, "manifest.json"), "{}\n", { mode: 0o640 });
        await expect(
          handoffFinalizedBidResult(
            finalized,
            jobId,
            createBidHandoffFileRuntimeForTesting(root, expectedGid),
          ),
        ).rejects.toThrow("CONVERSION_FAILED");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 20_000);
});
