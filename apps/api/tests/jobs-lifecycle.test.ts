import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { readdir, readFile, rename, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { ClamdClient, ScannerError } from "../src/jobs/clamdClient.js";
import { preflightJobInput } from "../src/jobs/inputPreflight.js";
import { runJobCleanup } from "../src/jobs/jobCleanup.js";
import { JobFileError, JobFiles } from "../src/jobs/jobFiles.js";
import { OpenTradPreflightError, preflightOpenTradArchive } from "../src/jobs/opentradPreflight.js";

const roots: string[] = [];
const servers: Server[] = [];

function privateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opentrad-task8-files-"));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

async function listen(
  connection: (socket: Socket) => void,
): Promise<{ host: string; port: number }> {
  const server = createServer(connection);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("listen failed");
  return { host: "127.0.0.1", port: address.port };
}

async function* chunks(...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

async function generatedPdf(pageCount: number, active = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) document.addPage([72, 72]);
  if (active) document.addJavaScript("OpenTradActive", "app.alert('blocked')");
  return document.save({ useObjectStreams: true });
}

function scannerCode(error: unknown): string | undefined {
  return error instanceof ScannerError ? error.code : undefined;
}

function posixAllows(
  info: { readonly gid: number; readonly mode: number; readonly uid: number },
  identity: { readonly uid: number; readonly gids: readonly number[] },
  permission: 0o1 | 0o2 | 0o4,
): boolean {
  const shift = identity.uid === info.uid ? 6 : identity.gids.includes(info.gid) ? 3 : 0;
  return ((info.mode >> shift) & permission) === permission;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("ClamAV zINSTREAM client", () => {
  it("frames chunks with backpressure and accepts a partial exact OK response", async () => {
    const received: Buffer[] = [];
    const endpoint = await listen((socket) => {
      socket.on("data", (chunk) => {
        received.push(Buffer.from(chunk));
        const all = Buffer.concat(received);
        if (all.subarray(-4).equals(Buffer.alloc(4))) {
          socket.write("stream: O");
          setImmediate(() => socket.end(Buffer.from("K\0")));
        }
      });
    });
    const client = new ClamdClient({ ...endpoint, timeoutMs: 1_000 });

    await expect(client.scan(chunks("abc", "de"))).resolves.toBe("clean");
    const protocol = Buffer.concat(received);
    expect(protocol.subarray(0, 10)).toEqual(Buffer.from("zINSTREAM\0"));
    expect(protocol.readUInt32BE(10)).toBe(3);
    expect(protocol.subarray(14, 17).toString()).toBe("abc");
    expect(protocol.readUInt32BE(17)).toBe(2);
    expect(protocol.subarray(21, 23).toString()).toBe("de");
    expect(protocol.readUInt32BE(23)).toBe(0);
  });

  it("maps an exact FOUND response to the fixed malware error", async () => {
    const endpoint = await listen((socket) => {
      socket.once("data", () => socket.end("stream: Eicar-Test-Signature FOUND\0"));
    });
    const client = new ClamdClient({ ...endpoint, timeoutMs: 1_000 });

    await expect(client.scan(chunks("private-body-sentinel"))).rejects.toSatisfy(
      (error: unknown) => scannerCode(error) === "MALWARE_DETECTED",
    );
  });

  it.each(["unexpected", "oversize", "early-close", "trailing", "timeout"] as const)(
    "maps %s responses to one non-disclosing unavailable error",
    async (mode) => {
      const endpoint = await listen((socket) => {
        socket.once("data", () => {
          if (mode === "unexpected") socket.end("stream: maybe\0");
          else if (mode === "oversize") socket.end("x".repeat(2_000));
          else if (mode === "early-close") socket.end();
          else if (mode === "trailing") socket.end("stream: OK\0trailing");
        });
      });
      const client = new ClamdClient({
        ...endpoint,
        timeoutMs: mode === "timeout" ? 25 : 1_000,
      });
      let failure: unknown;
      try {
        await client.scan(chunks("scanner-private-sentinel"));
      } catch (error) {
        failure = error;
      }
      expect(scannerCode(failure)).toBe("SCANNER_UNAVAILABLE");
      expect(String(failure)).not.toContain("sentinel");
      expect(String(failure)).not.toContain(mode);
    },
  );

  it("aborts the iterable and socket with the fixed unavailable error", async () => {
    let returned = false;
    const endpoint = await listen(() => {});
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => new Promise<IteratorResult<Uint8Array>>(() => {}),
          return: async (): Promise<IteratorResult<Uint8Array>> => {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    const controller = new AbortController();
    const client = new ClamdClient({ ...endpoint, timeoutMs: 1_000 });
    const pending = client.scan(source, controller.signal);
    setImmediate(() => controller.abort());

    await expect(pending).rejects.toSatisfy(
      (error: unknown) => scannerCode(error) === "SCANNER_UNAVAILABLE",
    );
    expect(returned).toBe(true);
  });

  it("stops pulling immediately when clamd returns an early response", async () => {
    let pulls = 0;
    let returned = false;
    const endpoint = await listen((socket) => {
      socket.once("data", () => socket.end("stream: protocol-error\0"));
    });
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<Uint8Array>> => {
            pulls += 1;
            await new Promise((resolve) => setImmediate(resolve));
            return { done: false, value: Buffer.alloc(1024) };
          },
          return: async (): Promise<IteratorResult<Uint8Array>> => {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    const client = new ClamdClient({ ...endpoint, timeoutMs: 1_000 });

    await expect(client.scan(source)).rejects.toSatisfy(
      (error: unknown) => scannerCode(error) === "SCANNER_UNAVAILABLE",
    );
    expect(pulls).toBeLessThanOrEqual(1);
    expect(returned).toBe(true);
  });
});

describe("private staged files", () => {
  it("uses one pull pipeline, exact byte accounting, private modes, and a fixed manifest", async () => {
    const root = join(privateRoot(), "jobs");
    const files = new JobFiles(root, { workerGid: process.getgid?.() ?? 0 });
    const jobId = randomUUID();
    const observedSizes: number[] = [];
    const result = await files.stageAndQueue({
      declaredBytes: 5,
      jobId,
      request: {
        inputBytes: 5,
        inputFormat: "docx",
        operation: "office.to.pdf",
        options: {},
        outputFormat: "pdf",
      },
      scan: async (source) => {
        for await (const _chunk of source) {
          const staging = await files.findStagingInput(jobId);
          observedSizes.push((await stat(staging)).size);
        }
        return "clean";
      },
      source: chunks("ab", "cde"),
    });

    expect(observedSizes).toEqual([2, 5]);
    expect(readFileSync(result.inputPath, "utf8")).toBe("abcde");
    expect(statSync(root).mode & 0o777).toBe(0o710);
    expect(statSync(join(root, "staging")).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, "queued")).mode & 0o777).toBe(0o770);
    expect(statSync(join(root, "running")).mode & 0o777).toBe(0o770);
    expect(statSync(join(root, "outbox")).mode & 0o777).toBe(0o770);
    expect(statSync(join(root, "done")).mode & 0o777).toBe(0o700);
    expect(statSync(result.directory).mode & 0o777).toBe(0o770);
    expect(statSync(result.inputPath).mode & 0o777).toBe(0o640);
    expect(statSync(result.inputPath).gid).toBe(process.getgid?.() ?? 0);
    expect(JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"))).toEqual({
      inputBytes: 5,
      inputFormat: "docx",
      jobId,
      operation: "office.to.pdf",
      options: {},
      outputFormat: "pdf",
      schemaVersion: "server-v1",
    });
    expect(await readdir(join(root, "staging"))).toEqual([]);
  });

  it("destroys staging when actual bytes mismatch or scanning fails", async () => {
    const root = join(privateRoot(), "jobs");
    const files = new JobFiles(root, { workerGid: process.getgid?.() ?? 0 });
    const mismatchId = randomUUID();
    await expect(
      files.stageAndQueue({
        declaredBytes: 4,
        jobId: mismatchId,
        request: { ...baseFileRequest, inputBytes: 4 },
        scan: async (source) => {
          for await (const _chunk of source) {
            // Pull the single bounded stream.
          }
          return "clean";
        },
        source: chunks("abc"),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );

    const scannerId = randomUUID();
    await expect(
      files.stageAndQueue({
        declaredBytes: 3,
        jobId: scannerId,
        request: { ...baseFileRequest, inputBytes: 3 },
        scan: async (source) => {
          for await (const _chunk of source) break;
          throw new ScannerError("SCANNER_UNAVAILABLE");
        },
        source: chunks("abc"),
      }),
    ).rejects.toSatisfy((error: unknown) => scannerCode(error) === "SCANNER_UNAVAILABLE");
    expect(await files.exists(mismatchId)).toBe(false);
    expect(await files.exists(scannerId)).toBe(false);
  });

  it("rejects invalid ids and symlink roots without disclosing paths", async () => {
    const parent = privateRoot();
    const target = join(parent, "target");
    const linked = join(parent, "linked");
    const { mkdirSync, symlinkSync } = await import("node:fs");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, linked);

    expect(() => new JobFiles(linked)).toThrow("JOB_ROOT_UNSAFE");
    const files = new JobFiles(join(parent, "jobs"), {
      workerGid: process.getgid?.() ?? 0,
    });
    await expect(
      files.stageAndQueue({
        declaredBytes: 1,
        jobId: "../private-path-sentinel",
        request: { ...baseFileRequest, inputBytes: 1 },
        scan: async () => "clean",
        source: chunks("x"),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof JobFileError &&
        error.code === "INVALID_REQUEST" &&
        !String(error).includes("sentinel"),
    );
  });

  it("accepts a private job root below public root-owned ancestors", () => {
    const parent = join(privateRoot(), "public-parent");
    mkdirSync(parent, { mode: 0o755 });
    const root = join(parent, "jobs");
    expect(() => new JobFiles(root, { workerGid: process.getgid?.() ?? 0 })).not.toThrow();
    expect(statSync(root).mode & 0o777).toBe(0o710);
  });

  it("gives a distinct shared-gid worker atomic state-directory write access only", async () => {
    const root = join(privateRoot(), "jobs");
    const workerGid = process.getgid?.() ?? 0;
    const files = new JobFiles(root, { workerGid });
    const jobId = randomUUID();
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId,
      request: { ...baseFileRequest, inputBytes: 1 },
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the exact staged stream.
        }
        return "clean";
      },
      source: chunks("x"),
    });

    const worker = { uid: (process.geteuid?.() ?? 501) + 10_000, gids: [workerGid] };
    const outsider = { uid: worker.uid + 1, gids: [workerGid + 1] };
    expect(statSync(root).mode & 0o777).toBe(0o710);
    expect(posixAllows(statSync(root), worker, 0o1)).toBe(true);
    expect(posixAllows(statSync(root), worker, 0o2)).toBe(false);
    for (const directory of [
      join(root, "queued"),
      join(root, "running"),
      join(root, "outbox"),
      files.queuedDirectory(jobId),
    ]) {
      const info = statSync(directory);
      expect(info.mode & 0o777).toBe(0o770);
      expect(posixAllows(info, worker, 0o1)).toBe(true);
      expect(posixAllows(info, worker, 0o2)).toBe(true);
      expect(posixAllows(info, outsider, 0o1)).toBe(false);
      expect(posixAllows(info, outsider, 0o2)).toBe(false);
    }
    expect(statSync(join(root, "staging")).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, "done")).mode & 0o777).toBe(0o700);
    expect(posixAllows(statSync(join(root, "done")), worker, 0o1)).toBe(false);
    expect(posixAllows(statSync(join(root, "done")), worker, 0o2)).toBe(false);

    for (const file of [
      join(files.queuedDirectory(jobId), "input.bin"),
      join(files.queuedDirectory(jobId), "manifest.json"),
    ]) {
      const info = statSync(file);
      expect(info.mode & 0o777).toBe(0o640);
      expect(posixAllows(info, worker, 0o4)).toBe(true);
      expect(posixAllows(info, worker, 0o2)).toBe(false);
      expect(posixAllows(info, outsider, 0o4)).toBe(false);
    }

    const running = join(root, "running", jobId);
    await rename(files.queuedDirectory(jobId), running);
    writeFileSync(join(running, "result.bin"), "result", { mode: 0o640 });
    await rename(running, files.outboxDirectory(jobId));
    expect(readFileSync(join(files.outboxDirectory(jobId), "result.bin"), "utf8")).toBe("result");
    await files.publishResult({ jobId, resultBytes: 6 });
    expect(readFileSync(files.resultPath(jobId), "utf8")).toBe("result");
    expect(statSync(join(root, "done", jobId)).mode & 0o777).toBe(0o700);
    expect(statSync(files.resultPath(jobId)).mode & 0o777).toBe(0o600);
    await expect(stat(files.outboxDirectory(jobId))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("owns abort cleanup even when an injected scanner ignores the signal", async () => {
    const files = new JobFiles(join(privateRoot(), "jobs"), {
      workerGid: process.getgid?.() ?? 0,
    });
    const controller = new AbortController();
    const jobId = randomUUID();
    const pending = files.stageAndQueue({
      declaredBytes: 1,
      jobId,
      request: { ...baseFileRequest, inputBytes: 1 },
      scan: async () => new Promise<"clean">(() => {}),
      signal: controller.signal,
      source: chunks("x"),
    });
    setImmediate(() => controller.abort());
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );
    expect(await files.exists(jobId)).toBe(false);
  });

  it("promotes a real worker result atomically and removes crash-orphan staging", async () => {
    const root = join(privateRoot(), "jobs");
    const files = new JobFiles(root, { workerGid: process.getgid?.() ?? 0 });
    const jobId = randomUUID();
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId,
      request: { ...baseFileRequest, inputBytes: 1 },
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the production stream.
        }
        return "clean";
      },
      source: chunks("x"),
    });
    await files.promoteResult({ jobId, resultBytes: 4, source: chunks("PDF!") });
    expect(readFileSync(files.resultPath(jobId), "utf8")).toBe("PDF!");

    const orphan = join(root, "staging", randomUUID());
    mkdirSync(orphan, { mode: 0o700 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(orphan, old, old);
    expect(await files.cleanupOrphanStaging(30_000, Date.now())).toBe(1);
    expect(() => statSync(orphan)).toThrow();
  });

  it("publishes only a complete worker result and resumes an interrupted private claim", async () => {
    const root = join(privateRoot(), "jobs");
    const files = new JobFiles(root, { workerGid: process.getgid?.() ?? 0 });
    const jobId = randomUUID();
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId,
      request: { ...baseFileRequest, inputBytes: 1 },
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the production stream.
        }
        return "clean";
      },
      source: chunks("x"),
    });
    const running = join(root, "running", jobId);
    await rename(files.queuedDirectory(jobId), running);
    writeFileSync(join(running, "result.bin"), "PDF!", { mode: 0o640 });
    writeFileSync(join(running, "unexpected.tmp"), "x", { mode: 0o640 });
    await rename(running, files.outboxDirectory(jobId));

    await expect(files.publishResult({ jobId, resultBytes: 4 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(stat(files.resultPath(jobId))).rejects.toMatchObject({ code: "ENOENT" });

    const claimed = join(root, "staging", jobId);
    rmSync(join(claimed, "unexpected.tmp"));
    await expect(files.publishResult({ jobId, resultBytes: 5 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(stat(files.resultPath(jobId))).rejects.toMatchObject({ code: "ENOENT" });

    const privateFixture = join(root, "private-publish-fixture");
    writeFileSync(privateFixture, "NOPE", { mode: 0o600 });
    rmSync(join(claimed, "result.bin"));
    symlinkSync(privateFixture, join(claimed, "result.bin"));
    await expect(files.publishResult({ jobId, resultBytes: 4 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(stat(files.resultPath(jobId))).rejects.toMatchObject({ code: "ENOENT" });

    rmSync(join(claimed, "result.bin"));
    writeFileSync(join(claimed, "result.bin"), "PDF!", { mode: 0o640 });
    await files.publishResult({ jobId, resultBytes: 4 });
    expect(readFileSync(files.resultPath(jobId), "utf8")).toBe("PDF!");
    await expect(stat(claimed)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("bounded durable cleanup", () => {
  it("never claims more work than the fixed cleanup batch", async () => {
    const pending = Array.from({ length: 32 }, () => ({
      jobId: randomUUID(),
      kind: "cancel" as const,
      token: randomUUID(),
    }));
    let expiredClaimCalls = 0;
    let destroyed = 0;
    await runJobCleanup({
      files: {
        cleanupOrphanStaging: async () => 0,
        destroy: async () => {
          destroyed += 1;
        },
      },
      repository: {
        claimExpiredCleanup: () => {
          expiredClaimCalls += 1;
          return [];
        },
        claimPendingCleanup: () => pending,
        completeCleanup: () => true,
        releaseCleanupClaim: () => true,
      },
    });
    expect(destroyed).toBe(32);
    expect(expiredClaimCalls).toBe(0);
  });
});

const baseFileRequest = {
  inputBytes: 1,
  inputFormat: "docx",
  operation: "office.to.pdf",
  options: {},
  outputFormat: "pdf",
} as const;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: ReadonlyArray<{ path: string; data: Uint8Array }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = Buffer.from(entry.path, "utf8");
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + path.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(path.length, 26);
    path.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + path.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(localOffset, 42);
    path.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

describe("canonical OpenTrad bid admission", () => {
  const bidOptions = {
    templateId: "bid.government.goods.v1",
    templateVersion: "1.0.0",
  } as const;

  function archive(
    overrides: Record<string, unknown> = {},
    extraEntries: Array<{ path: string; data: Uint8Array }> = [],
  ) {
    const template = {
      id: bidOptions.templateId,
      version: bidOptions.templateVersion,
      basisDate: "2026-08-19",
    } as const;
    const presentation = { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" } as const;
    const outerAttachments: unknown[] = [];
    const draft = Buffer.from(
      JSON.stringify({
        formatVersion: "2.0.0",
        template,
        draft: {
          id: "bid-draft-1",
          templateId: bidOptions.templateId,
          templateVersion: bidOptions.templateVersion,
        },
        presentation,
        attachmentManifest: outerAttachments,
      }),
      "utf8",
    );
    const bidAssembly = {
      templateId: bidOptions.templateId,
      templateVersion: bidOptions.templateVersion,
      body: { byteLength: draft.length, pageCount: 1 },
      attachmentManifest: [],
      ...overrides,
    };
    const manifest = {
      formatVersion: "2.0.0",
      template,
      presentation,
      attachmentManifest: outerAttachments,
      files: [],
      bidAssembly,
    };
    return storedZip([
      { path: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") },
      { path: "draft.json", data: draft },
      ...extraEntries,
    ]);
  }

  function pdfArchive(pdf: Uint8Array, declaredPageCount: number): Buffer {
    const template = {
      id: bidOptions.templateId,
      version: bidOptions.templateVersion,
      basisDate: "2026-08-19",
    } as const;
    const presentation = { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" } as const;
    const attachment = {
      id: "technical",
      category: "technical",
      displayName: "Technical",
      mediaType: "application/pdf",
      pageCount: declaredPageCount,
      required: true,
      status: "attached",
      includedInSubmission: true,
    } as const;
    const draft = Buffer.from(
      JSON.stringify({
        formatVersion: "2.0.0",
        template,
        draft: {
          id: "bid-draft-pdf",
          templateId: bidOptions.templateId,
          templateVersion: bidOptions.templateVersion,
        },
        presentation,
        attachmentManifest: [attachment],
      }),
    );
    const manifest = {
      formatVersion: "2.0.0",
      template,
      presentation,
      attachmentManifest: [attachment],
      files: [
        {
          id: attachment.id,
          path: "attachments/technical.pdf",
          mediaType: attachment.mediaType,
          byteLength: pdf.byteLength,
          pageCount: declaredPageCount,
        },
      ],
      bidAssembly: {
        ...bidOptions,
        body: { byteLength: draft.length, pageCount: 1 },
        attachmentManifest: [
          { ...attachment, byteLength: pdf.byteLength, pageCount: declaredPageCount },
        ],
      },
    };
    return storedZip([
      { path: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { path: "draft.json", data: draft },
      { path: "attachments/technical.pdf", data: pdf },
    ]);
  }

  function twoPdfArchive(pdf: Uint8Array): Buffer {
    const template = {
      id: bidOptions.templateId,
      version: bidOptions.templateVersion,
      basisDate: "2026-08-19",
    } as const;
    const presentation = { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" } as const;
    const attachments = ["one", "two"].map((id) => ({
      id,
      category: "technical" as const,
      displayName: id,
      mediaType: "application/pdf" as const,
      pageCount: 1,
      required: true,
      status: "attached" as const,
      includedInSubmission: true,
    }));
    const draft = Buffer.from(
      JSON.stringify({
        formatVersion: "2.0.0",
        template,
        draft: {
          id: "bid-two-pdf",
          templateId: bidOptions.templateId,
          templateVersion: bidOptions.templateVersion,
        },
        presentation,
        attachmentManifest: attachments,
      }),
    );
    const files = attachments.map((attachment) => ({
      id: attachment.id,
      path: `attachments/${attachment.id}.pdf`,
      mediaType: attachment.mediaType,
      byteLength: pdf.byteLength,
      pageCount: 1,
    }));
    const manifest = {
      formatVersion: "2.0.0",
      template,
      presentation,
      attachmentManifest: attachments,
      files,
      bidAssembly: {
        ...bidOptions,
        body: { byteLength: draft.length, pageCount: 1 },
        attachmentManifest: attachments.map((attachment) => ({
          ...attachment,
          byteLength: pdf.byteLength,
        })),
      },
    };
    return storedZip([
      { path: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { path: "draft.json", data: draft },
      ...files.map((file) => ({ path: file.path, data: pdf })),
    ]);
  }

  it("accepts an exact STORE archive and contracts manifest identity", async () => {
    const path = join(privateRoot(), "valid.opentrad");
    writeFileSync(path, archive(), { mode: 0o600 });
    await expect(preflightOpenTradArchive(path, bidOptions)).resolves.toEqual({
      attachmentBytes: 0,
      attachmentCount: 0,
      bodyBytes: Buffer.byteLength(
        JSON.stringify({
          formatVersion: "2.0.0",
          template: {
            id: bidOptions.templateId,
            version: bidOptions.templateVersion,
            basisDate: "2026-08-19",
          },
          draft: {
            id: "bid-draft-1",
            templateId: bidOptions.templateId,
            templateVersion: bidOptions.templateVersion,
          },
          presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
          attachmentManifest: [],
        }),
      ),
      entryCount: 2,
    });
  });

  it.each([
    ["template mismatch", { templateId: "bid.enterprise.goods.v1" }, []],
    ["unknown extra", {}, [{ path: "extra.bin", data: Buffer.from("x") }]],
    ["path traversal", {}, [{ path: "attachments/../secret.pdf", data: Buffer.from("x") }]],
  ] as const)("rejects %s without exposing archive data", async (_name, overrides, extras) => {
    const path = join(privateRoot(), `${randomUUID()}.opentrad`);
    writeFileSync(path, archive({ ...overrides }, [...extras]), { mode: 0o600 });
    let failure: unknown;
    try {
      await preflightOpenTradArchive(path, bidOptions);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OpenTradPreflightError);
    expect((failure as OpenTradPreflightError).code).toBe("INVALID_REQUEST");
    expect(String(failure)).not.toContain(path);
  });

  it("rejects a legacy canonical bid archive without bidAssembly", async () => {
    const draft = Buffer.from("{}", "utf8");
    const legacy = {
      formatVersion: "2.0.0",
      template: {
        ...bidOptions,
        id: bidOptions.templateId,
        version: bidOptions.templateVersion,
        basisDate: "2026-08-19",
      },
      presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
      attachmentManifest: [],
      files: [],
    };
    const path = join(privateRoot(), "legacy.opentrad");
    writeFileSync(
      path,
      storedZip([
        { path: "manifest.json", data: Buffer.from(JSON.stringify(legacy)) },
        { path: "draft.json", data: draft },
      ]),
      { mode: 0o600 },
    );
    await expect(preflightOpenTradArchive(path, bidOptions)).rejects.toBeInstanceOf(
      OpenTradPreflightError,
    );
  });

  it("rejects a draft envelope whose format or template identity differs", async () => {
    const template = {
      id: bidOptions.templateId,
      version: bidOptions.templateVersion,
      basisDate: "2026-08-19",
    };
    const presentation = { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" };
    const draft = Buffer.from(
      JSON.stringify({
        formatVersion: "2.0.0",
        template,
        draft: {
          id: "mismatch",
          templateId: "bid.enterprise.goods.v1",
          templateVersion: "1.0.0",
        },
        presentation,
        attachmentManifest: [],
      }),
    );
    const outer = {
      formatVersion: "2.0.0",
      template,
      presentation,
      attachmentManifest: [],
      files: [],
      bidAssembly: {
        ...bidOptions,
        body: { byteLength: draft.length, pageCount: 1 },
        attachmentManifest: [],
      },
    };
    const path = join(privateRoot(), "draft-mismatch.opentrad");
    writeFileSync(
      path,
      storedZip([
        { path: "manifest.json", data: Buffer.from(JSON.stringify(outer)) },
        { path: "draft.json", data: draft },
      ]),
      { mode: 0o600 },
    );
    await expect(preflightOpenTradArchive(path, bidOptions)).rejects.toBeInstanceOf(
      OpenTradPreflightError,
    );
  });

  it("rejects attachment bytes whose magic disagrees with the manifest", async () => {
    const template = {
      id: bidOptions.templateId,
      version: bidOptions.templateVersion,
      basisDate: "2026-08-19",
    };
    const presentation = { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" };
    const attachment = {
      id: "technical",
      category: "technical",
      displayName: "Technical",
      mediaType: "application/pdf",
      pageCount: 1,
      required: true,
      status: "attached",
      includedInSubmission: true,
    } as const;
    const draft = Buffer.from(
      JSON.stringify({
        formatVersion: "2.0.0",
        template,
        draft: { id: "bid", templateId: bidOptions.templateId, templateVersion: "1.0.0" },
        presentation,
        attachmentManifest: [attachment],
      }),
    );
    const badPdf = Buffer.from("not-pdf");
    const outer = {
      formatVersion: "2.0.0",
      template,
      presentation,
      attachmentManifest: [attachment],
      files: [
        {
          id: attachment.id,
          path: "attachments/technical.pdf",
          mediaType: attachment.mediaType,
          byteLength: badPdf.length,
          pageCount: 1,
        },
      ],
      bidAssembly: {
        ...bidOptions,
        body: { byteLength: draft.length, pageCount: 1 },
        attachmentManifest: [{ ...attachment, byteLength: badPdf.length }],
      },
    };
    const path = join(privateRoot(), "bad-magic.opentrad");
    writeFileSync(
      path,
      storedZip([
        { path: "manifest.json", data: Buffer.from(JSON.stringify(outer)) },
        { path: "draft.json", data: draft },
        { path: "attachments/technical.pdf", data: badPdf },
      ]),
      { mode: 0o600 },
    );
    await expect(preflightOpenTradArchive(path, bidOptions)).rejects.toBeInstanceOf(
      OpenTradPreflightError,
    );
  });

  it("rejects an active-content PDF attachment", async () => {
    const path = join(privateRoot(), "active-pdf.opentrad");
    writeFileSync(path, pdfArchive(await generatedPdf(1, true), 1), { mode: 0o600 });
    await expect(preflightOpenTradArchive(path, bidOptions)).rejects.toBeInstanceOf(
      OpenTradPreflightError,
    );
  });

  it("rejects a PDF attachment whose true page count differs from every manifest layer", async () => {
    const path = join(privateRoot(), "page-mismatch.opentrad");
    writeFileSync(path, pdfArchive(await generatedPdf(2), 1), { mode: 0o600 });
    await expect(preflightOpenTradArchive(path, bidOptions)).rejects.toBeInstanceOf(
      OpenTradPreflightError,
    );
  });

  it("accepts the real eighty-page bid boundary", async () => {
    const path = join(privateRoot(), "page-boundary.opentrad");
    writeFileSync(path, pdfArchive(await generatedPdf(79), 79), { mode: 0o600 });
    await expect(preflightOpenTradArchive(path, bidOptions)).resolves.toMatchObject({
      attachmentCount: 1,
      entryCount: 3,
    });
  });

  it("uses one absolute archive deadline across every PDF inspection", async () => {
    const path = join(privateRoot(), "aggregate-deadline.opentrad");
    writeFileSync(path, twoPdfArchive(await generatedPdf(1)), { mode: 0o600 });
    let now = 1_000;
    const deadlines: number[] = [];
    const preflightWithRuntime = preflightOpenTradArchive as unknown as (
      inputPath: string,
      inputOptions: typeof bidOptions,
      signal: AbortSignal | undefined,
      runtime: {
        readonly inspectPdf: (
          bytes: Uint8Array,
          maximumPages: number,
          signal: AbortSignal | undefined,
          deadline: number,
        ) => Promise<{ readonly pageCount: number }>;
        readonly now: () => number;
      },
    ) => Promise<unknown>;

    await expect(
      preflightWithRuntime(path, bidOptions, undefined, {
        inspectPdf: async (_bytes, _maximumPages, _signal, deadline) => {
          deadlines.push(deadline);
          now += 6_000;
          return { pageCount: 1 };
        },
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(OpenTradPreflightError);
    expect(deadlines).toEqual([11_000, 11_000]);
  });
});

describe("bounded declared-format preflight", () => {
  async function inspectOcrPdf(bytes: Uint8Array): Promise<void> {
    const path = join(privateRoot(), `${randomUUID()}.pdf`);
    writeFileSync(path, bytes);
    await preflightJobInput(path, {
      inputBytes: bytes.byteLength,
      inputFormat: "pdf",
      operation: "ocr.pdf",
      options: {},
      outputFormat: "txt",
    });
  }

  it("rejects a generic ftyp box that is not AVIF", async () => {
    const path = join(privateRoot(), "fake.avif");
    writeFileSync(
      path,
      Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x6a, 0x75, 0x6e, 0x6b, 0, 0, 0, 0]),
    );
    await expect(
      preflightJobInput(path, {
        inputBytes: 16,
        inputFormat: "avif",
        operation: "image.convert.hq",
        options: {},
        outputFormat: "png",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );
  });

  it("counts compressed object-stream pages semantically", async () => {
    await expect(inspectOcrPdf(await generatedPdf(20))).resolves.toBeUndefined();
    await expect(inspectOcrPdf(await generatedPdf(100))).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "PAGE_LIMIT_EXCEEDED",
    );
  });

  it("rejects a real one-page PDF with embedded JavaScript", async () => {
    await expect(inspectOcrPdf(await generatedPdf(1, true))).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );
  });

  it("rejects an encrypted PDF with the fixed encrypted code", async () => {
    const encrypted = Buffer.from(
      "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGJkMWViZDQzZTI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA3MiA3MiBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1YgMgovUiAzCi9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDU3MWQyMjk4Y2FiNjFhN2JlZGQwODVmNjY2MGNlZDRjZTY1YjFiMTEyMjc3ZDYwMjE1YmVjYmY1NjNhZDEwYTA+Ci9VIDwwNmQ5ODE2YzU2ZWU0ZWZiOWYxMmMxZDc3NGU1M2ZlNjI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4Pgo+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTkgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMTY3IDAwMDAwIG4gCjAwMDAwMDAyNTkgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA2Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDw2NDY2NjM2MTY2MzUzNDMyMzczOTMwMzMzMjMwMzY2NDY0MzEzMTM0MzQzMTY0MzA2MjM1NjI2MTM5MzYzMTYyPiA8NjQ2NjM2MTY2MzUzNDMyMzczOTMwMzMzMjMwMzY2NDY0MzEzMTM0MzQzMTY0MzA2MjM1NjI2MTM5MzYzMTYyPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzQKJSVFT0YK",
      "base64",
    );
    await expect(inspectOcrPdf(encrypted)).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "ENCRYPTED_INPUT",
    );
  });

  it("rejects a hostile broken xref/object-stream PDF with a fixed code", async () => {
    const hostile = Buffer.from(await generatedPdf(2));
    hostile.fill(0x78, Math.max(0, hostile.length - 48));
    await expect(inspectOcrPdf(hostile)).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );
  });
});
