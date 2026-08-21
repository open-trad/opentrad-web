import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { lstat, readdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateJobRequest } from "@opentrad/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrationSql } from "../src/db/migrate.js";
import { JobFiles } from "../src/jobs/jobFiles.js";
import {
  type JobReconciliationRuntime,
  runJobReconciliation,
  startJobReconciliation,
} from "../src/jobs/jobReconcile.js";
import { JobRepository } from "../src/jobs/jobRepository.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
const workerGid = process.getgid?.() ?? 0;
const JOB_ID = "00000000-0000-4000-8000-000000000030";

function privateRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), "opentrad-job-reconcile-"));
  chmodSync(parent, 0o700);
  roots.push(parent);
  return join(parent, "jobs");
}

function database(): Database.Database {
  const value = new Database(":memory:");
  databases.push(value);
  value.pragma("foreign_keys = ON");
  value.exec(migrationSql("001_auth"));
  value.exec(migrationSql("002_jobs"));
  value.exec(migrationSql("003_job_admission"));
  value.exec(migrationSql("004_job_cleanup"));
  return value;
}

async function* oneByte(): AsyncGenerator<Uint8Array> {
  yield Uint8Array.of(0x78);
}

async function queued(files: JobFiles): Promise<void> {
  await files.stageAndQueue({
    declaredBytes: 1,
    jobId: JOB_ID,
    request: {
      inputBytes: 1,
      inputFormat: "docx",
      operation: "office.to.pdf",
      options: {},
      outputFormat: "pdf",
    },
    scan: async (source) => {
      for await (const _chunk of source) {
        // Consume the exact upload stream.
      }
      return "clean";
    },
    source: oneByte(),
  });
}

async function workerCompletion(
  files: JobFiles,
  root: string,
  status:
    | { schemaVersion: "worker-result-v1"; status: "cancelled" }
    | {
        errorCode: "CONVERSION_FAILED";
        retryable: false;
        schemaVersion: "worker-result-v1";
        status: "failed";
      }
    | {
        mediaType: "application/pdf";
        resultBytes: 4;
        schemaVersion: "worker-result-v1";
        status: "succeeded";
      },
): Promise<void> {
  await queued(files);
  const running = join(root, "running", JOB_ID);
  await rename(files.queuedDirectory(JOB_ID), running);
  if (status.status === "succeeded") {
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
  }
  writeFileSync(join(running, "status.json"), `${JSON.stringify(status)}\n`, { mode: 0o640 });
  await rename(running, files.outboxDirectory(JOB_ID));
}

function runtime(
  files: JobFiles,
  repository: Partial<JobReconciliationRuntime["repository"]> = {},
): JobReconciliationRuntime {
  return {
    files,
    repository: {
      markRunning: repository.markRunning ?? (() => true),
      markTerminal: repository.markTerminal ?? (() => true),
      pendingCancellationJobIds: repository.pendingCancellationJobIds ?? (() => []),
      workerJobState:
        repository.workerJobState ??
        (() => Object.freeze({ cancelRequested: false, status: "running" as const })),
      workerTerminalState: repository.workerTerminalState ?? (() => undefined),
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const value of databases.splice(0)) value.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("API worker reconciliation", () => {
  it("atomically claims and publishes one strict succeeded outbox", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await workerCompletion(files, root, {
      mediaType: "application/pdf",
      resultBytes: 4,
      schemaVersion: "worker-result-v1",
      status: "succeeded",
    });
    const markTerminal = vi.fn(() => true);

    await runJobReconciliation(runtime(files, { markTerminal }));

    expect(await readFile(files.resultPath(JOB_ID), "utf8")).toBe("%PDF");
    expect(markTerminal).toHaveBeenCalledWith(JOB_ID, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });
    expect(await readdir(join(root, "outbox"))).toEqual([]);
  });

  it("lets authoritative DB cancellation discard a raced successful result", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await workerCompletion(files, root, {
      mediaType: "application/pdf",
      resultBytes: 4,
      schemaVersion: "worker-result-v1",
      status: "succeeded",
    });
    const markTerminal = vi.fn(() => true);

    await runJobReconciliation(
      runtime(files, {
        markTerminal,
        workerJobState: () =>
          Object.freeze({ cancelRequested: true, status: "cancelling" as const }),
      }),
    );

    await expect(lstat(files.resultPath(JOB_ID))).rejects.toMatchObject({ code: "ENOENT" });
    expect(markTerminal).toHaveBeenCalledWith(JOB_ID, "cancelled");
  });

  it("lets a DB cancellation interleaved after private publication discard success", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    const repository = new JobRepository(database(), {
      idempotencySecret: "reconcile-race-secret".repeat(4),
    });
    const ownerId = randomUUID();
    const request = {
      inputBytes: 1,
      inputFormat: "docx",
      operation: "office.to.pdf",
      options: {},
      outputFormat: "pdf",
    } as const;
    const job = repository.reserveAdmission({
      idempotencyKey: "reconcile-cancel-race-idempotency-key-0001",
      ownerId,
      request,
    }).job;
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId: job.id,
      request,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the exact source.
        }
        return "clean";
      },
      source: oneByte(),
    });
    const running = join(root, "running", job.id);
    await rename(files.queuedDirectory(job.id), running);
    expect(repository.markRunning(job.id)).toBe(true);
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    await rename(running, files.outboxDirectory(job.id));
    const publish = files.publishResult.bind(files);
    Object.defineProperty(files, "publishResult", {
      configurable: true,
      value: async (...args: Parameters<JobFiles["publishResult"]>) => {
        await publish(...args);
        expect(repository.cancelOwnedJob(ownerId, job.id)?.job.status).toBe("cancelling");
      },
    });

    await runJobReconciliation({ files, repository });

    expect(repository.findOwnedJob(ownerId, job.id)?.status).toBe("cancelled");
    await expect(lstat(files.resultPath(job.id))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await files.listWorkerCompletionIds()).toEqual([]);
  });

  it("keeps a committed success visible when a later cancellation loses", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    const repository = new JobRepository(database(), {
      idempotencySecret: "reconcile-success-secret".repeat(4),
    });
    const ownerId = randomUUID();
    const request = {
      inputBytes: 1,
      inputFormat: "docx",
      operation: "office.to.pdf",
      options: {},
      outputFormat: "pdf",
    } as const;
    const job = repository.reserveAdmission({
      idempotencyKey: "reconcile-success-race-idempotency-key-0001",
      ownerId,
      request,
    }).job;
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId: job.id,
      request,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the exact source.
        }
        return "clean";
      },
      source: oneByte(),
    });
    const running = join(root, "running", job.id);
    await rename(files.queuedDirectory(job.id), running);
    expect(repository.markRunning(job.id)).toBe(true);
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    await rename(running, files.outboxDirectory(job.id));

    await runJobReconciliation({ files, repository });
    expect(repository.cancelOwnedJob(ownerId, job.id)?.job.status).toBe("succeeded");

    expect(repository.findOwnedJob(ownerId, job.id)?.result?.mediaType).toBe("application/pdf");
    expect(await readFile(files.resultPath(job.id), "utf8")).toBe("%PDF");
  });

  it("rejects a worker completion whose media or magic disagrees with the admitted manifest", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await workerCompletion(files, root, {
      mediaType: "image/jpeg" as "application/pdf",
      resultBytes: 4,
      schemaVersion: "worker-result-v1",
      status: "succeeded",
    });
    const markTerminal = vi.fn(() => true);

    await runJobReconciliation(runtime(files, { markTerminal }));

    expect(markTerminal).not.toHaveBeenCalled();
    await expect(lstat(files.resultPath(JOB_ID))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await files.listWorkerCompletionIds()).toEqual([JOB_ID]);
  });

  it.each([
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "office.to.pdf",
        options: {},
        outputFormat: "pdf",
      },
      "application/pdf",
      Buffer.from("%PDF"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "xlsx",
        operation: "spreadsheet.to.csv",
        options: {},
        outputFormat: "csv",
      },
      "text/csv",
      Buffer.from([0xef, 0xbb, 0xbf, 0x78]),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "structured.convert",
        options: {},
        outputFormat: "docx",
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Buffer.from("PK"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "structured.convert",
        options: {},
        outputFormat: "odt",
      },
      "application/vnd.oasis.opendocument.text",
      Buffer.from("PK"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "structured.convert",
        options: {},
        outputFormat: "rtf",
      },
      "application/rtf",
      Buffer.from("{\\rtf1}"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "structured.convert",
        options: {},
        outputFormat: "html",
      },
      "text/html",
      Buffer.from("<!doctype html>"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "docx",
        operation: "structured.convert",
        options: {},
        outputFormat: "md",
      },
      "text/markdown",
      Buffer.from("# x\n"),
    ],
    [
      { inputBytes: 1, inputFormat: "pdf", operation: "ocr.pdf", options: {}, outputFormat: "txt" },
      "text/plain",
      Buffer.from("x"),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "png",
        operation: "image.convert.hq",
        options: {},
        outputFormat: "png",
      },
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "png",
        operation: "image.convert.hq",
        options: {},
        outputFormat: "jpg",
      },
      "image/jpeg",
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "png",
        operation: "image.convert.hq",
        options: {},
        outputFormat: "webp",
      },
      "image/webp",
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ],
    [
      {
        inputBytes: 1,
        inputFormat: "png",
        operation: "image.convert.hq",
        options: {},
        outputFormat: "avif",
      },
      "image/avif",
      Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
    ],
  ] as const)("accepts the canonical %s worker result", async (request, mediaType, bytes) => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId: JOB_ID,
      request: request as CreateJobRequest,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the exact test source.
        }
        return "clean";
      },
      source: oneByte(),
    });
    const running = join(root, "running", JOB_ID);
    await rename(files.queuedDirectory(JOB_ID), running);
    writeFileSync(join(running, "result.bin"), bytes, { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType,
        resultBytes: bytes.byteLength,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    await rename(running, files.outboxDirectory(JOB_ID));

    await expect(files.claimWorkerCompletion(JOB_ID)).resolves.toMatchObject({ mediaType });
  });

  it("retries from the API-private success journal after a DB terminal update failure", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await workerCompletion(files, root, {
      mediaType: "application/pdf",
      resultBytes: 4,
      schemaVersion: "worker-result-v1",
      status: "succeeded",
    });
    let attempts = 0;
    const markTerminal = vi.fn(() => {
      attempts += 1;
      return attempts > 1;
    });
    const value = runtime(files, { markTerminal });

    await runJobReconciliation(value);
    expect(await readFile(files.resultPath(JOB_ID), "utf8")).toBe("%PDF");
    expect(await files.listWorkerCompletionIds()).toEqual([JOB_ID]);
    await runJobReconciliation(value);
    expect(markTerminal).toHaveBeenCalledTimes(2);
    expect(await files.listWorkerCompletionIds()).toEqual([]);
  });

  it("preserves a committed successful result after crashing before journal cleanup", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    const repository = new JobRepository(database(), {
      idempotencySecret: "reconcile-committed-secret".repeat(4),
    });
    const ownerId = randomUUID();
    const request = {
      inputBytes: 1,
      inputFormat: "docx",
      operation: "office.to.pdf",
      options: {},
      outputFormat: "pdf",
    } as const;
    const job = repository.reserveAdmission({
      idempotencyKey: "reconcile-committed-idempotency-key-0001",
      ownerId,
      request,
    }).job;
    await files.stageAndQueue({
      declaredBytes: 1,
      jobId: job.id,
      request,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the exact source.
        }
        return "clean";
      },
      source: oneByte(),
    });
    const running = join(root, "running", job.id);
    await rename(files.queuedDirectory(job.id), running);
    expect(repository.markRunning(job.id)).toBe(true);
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    await rename(running, files.outboxDirectory(job.id));
    const complete = files.completeWorkerReconciliation.bind(files);
    let failCleanup = true;
    Object.defineProperty(files, "completeWorkerReconciliation", {
      configurable: true,
      value: async (...args: Parameters<JobFiles["completeWorkerReconciliation"]>) => {
        if (failCleanup) throw new Error("simulated-post-commit-crash");
        await complete(...args);
      },
    });

    await runJobReconciliation({ files, repository });
    expect(repository.findOwnedJob(ownerId, job.id)?.status).toBe("succeeded");
    expect(await readFile(files.resultPath(job.id), "utf8")).toBe("%PDF");
    expect(await files.listWorkerCompletionIds()).toEqual([job.id]);

    failCleanup = false;
    await runJobReconciliation({ files, repository });

    expect(repository.findOwnedJob(ownerId, job.id)?.result).toEqual({
      mediaType: "application/pdf",
      ready: true,
      sizeBytes: 4,
    });
    expect(await readFile(files.resultPath(job.id), "utf8")).toBe("%PDF");
    expect(await files.listWorkerCompletionIds()).toEqual([]);
  });

  it.each(["failed", "cancelled"] as const)(
    "cleans a strict %s outbox before marking the database terminal",
    async (status) => {
      const root = privateRoot();
      const files = new JobFiles(root, { workerGid });
      await workerCompletion(
        files,
        root,
        status === "failed"
          ? {
              errorCode: "CONVERSION_FAILED",
              retryable: false,
              schemaVersion: "worker-result-v1",
              status,
            }
          : { schemaVersion: "worker-result-v1", status },
      );
      const markTerminal = vi.fn(() => true);

      await runJobReconciliation(runtime(files, { markTerminal }));

      expect(await files.exists(JOB_ID)).toBe(false);
      if (status === "failed") {
        expect(markTerminal).toHaveBeenCalledWith(JOB_ID, status, {
          errorCode: "CONVERSION_FAILED",
          retryable: false,
        });
      } else {
        expect(markTerminal).toHaveBeenCalledWith(JOB_ID, status);
      }
    },
  );

  it("rebuilds cancellation markers from durable DB intent on every tick", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await queued(files);
    await rename(files.queuedDirectory(JOB_ID), join(root, "running", JOB_ID));

    await runJobReconciliation(
      runtime(files, { pendingCancellationJobIds: () => Object.freeze([JOB_ID]) }),
    );

    expect(await readdir(join(root, "control"))).toEqual([`${JOB_ID}.cancel`]);
  });

  it("runs immediately, never overlaps ticks, and clears the interval on close", async () => {
    const files = new JobFiles(privateRoot(), { workerGid });
    let calls = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtimeValue = runtime(files, {
      pendingCancellationJobIds: () => {
        calls += 1;
        return [];
      },
    });
    const original = files.listWorkerCompletionIds.bind(files);
    files.listWorkerCompletionIds = vi.fn(async (...args) => {
      await pending;
      return original(...args);
    });
    const clear = vi.fn();
    let scheduled: (() => void) | undefined;
    const started = startJobReconciliation(runtimeValue, {
      clearInterval: clear,
      intervalMs: 1_000,
      setInterval: (run) => {
        scheduled = run;
        return Object.freeze({}) as NodeJS.Timeout;
      },
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    scheduled?.();
    expect(calls).toBe(1);
    release?.();
    const controller = await started;
    controller.stop();
    expect(clear).toHaveBeenCalledOnce();
  });
});
