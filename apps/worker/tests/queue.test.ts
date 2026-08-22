import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerQueue } from "../src/queue.js";

const roots: string[] = [];
const workerGid = process.getgid?.() ?? 0;
const FIRST_JOB = "00000000-0000-4000-8000-000000000001";
const SECOND_JOB = "00000000-0000-4000-8000-000000000002";
const RESULT_MEDIA_TYPES = [
  "application/pdf",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
] as const;

async function privateRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "opentrad-worker-queue-"));
  roots.push(parent);
  const root = join(parent, "jobs");
  await mkdir(root, { mode: 0o710 });
  await chmod(root, 0o710);
  for (const state of ["queued", "running", "outbox"]) {
    const path = join(root, state);
    await mkdir(path, { mode: 0o2770 });
    await chmod(path, 0o2770);
  }
  await mkdir(join(root, "control"), { mode: 0o750 });
  await chmod(join(root, "control"), 0o750);
  return realpath(root);
}

async function createQueued(root: string, jobId: string): Promise<void> {
  const directory = join(root, "queued", jobId);
  await mkdir(directory, { mode: 0o2770 });
  await chmod(directory, 0o2770);
  await writeFile(join(directory, "input.bin"), Uint8Array.of(0x25, 0x50, 0x44, 0x46), {
    mode: 0o640,
  });
  await chmod(join(directory, "input.bin"), 0o640);
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: "server-v1",
      jobId,
      operation: "pdf.repair",
      inputFormat: "pdf",
      outputFormat: "pdf",
      options: {},
      inputBytes: 4,
    })}\n`,
    { mode: 0o640 },
  );
  await chmod(join(directory, "manifest.json"), 0o640);
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("worker queue", () => {
  it("claims one queued directory with one atomic queued-to-running rename", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });

    const claim = await queue.claimNext();

    expect(claim).toMatchObject({
      directory: join(root, "running", FIRST_JOB),
      inputPath: join(root, "running", FIRST_JOB, "input.bin"),
      jobId: FIRST_JOB,
      manifestPath: join(root, "running", FIRST_JOB, "manifest.json"),
    });
    await expect(lstat(join(root, "queued", FIRST_JOB))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(join(root, "running", FIRST_JOB))).isDirectory()).toBe(true);
  });

  it("lets only one queue instance win a concurrent claim", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const first = new WorkerQueue(root, { workerGid });
    const second = new WorkerQueue(root, { workerGid });

    const claims = await Promise.all([first.claimNext(), second.claimNext()]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });

  it("claims valid UUID jobs in deterministic lexical order", async () => {
    const root = await privateRoot();
    await createQueued(root, SECOND_JOB);
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });

    expect((await queue.claimNext())?.jobId).toBe(FIRST_JOB);
    expect((await queue.claimNext())?.jobId).toBe(SECOND_JOB);
    expect(await queue.claimNext()).toBeNull();
  });

  it("returns a frozen null-prototype claim snapshot", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);

    const claim = await new WorkerQueue(root, { workerGid }).claimNext();

    expect(Object.getPrototypeOf(claim)).toBeNull();
    expect(Object.isFrozen(claim)).toBe(true);
  });

  it("fails closed before claiming directories with extra or linked entries", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    await writeFile(join(root, "queued", FIRST_JOB, "private-name.txt"), "PRIVATE");
    const queue = new WorkerQueue(root, { workerGid });

    await expect(queue.claimNext()).rejects.toThrow("WORKER_QUEUE_INVALID");
    expect((await lstat(join(root, "queued", FIRST_JOB))).isDirectory()).toBe(true);

    await rm(join(root, "queued", FIRST_JOB, "private-name.txt"));
    await rm(join(root, "queued", FIRST_JOB, "input.bin"));
    await symlink("/etc/passwd", join(root, "queued", FIRST_JOB, "input.bin"));
    await expect(queue.claimNext()).rejects.toThrow("WORKER_QUEUE_INVALID");
  });

  it("rejects unsafe shared parent modes and wrong-gid job files", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    await chmod(join(root, "queued"), 0o770);
    expect(() => new WorkerQueue(root, { workerGid })).toThrow("WORKER_QUEUE_INVALID");

    await chmod(join(root, "queued"), 0o2770);
    await chmod(join(root, "queued", FIRST_JOB, "input.bin"), 0o600);
    await expect(new WorkerQueue(root, { workerGid }).claimNext()).rejects.toThrow(
      "WORKER_QUEUE_INVALID",
    );
  });

  it("does not invoke accessor or Proxy configuration values", async () => {
    const root = await privateRoot();
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "workerGid", {
      get() {
        getterCalls += 1;
        throw new Error("PRIVATE_QUEUE_CONFIGURATION");
      },
    });
    expect(() => new WorkerQueue(root, hostile)).toThrow("WORKER_QUEUE_INVALID");
    expect(getterCalls).toBe(0);
    expect(
      () =>
        new WorkerQueue(
          root,
          new Proxy(
            { workerGid },
            {
              ownKeys() {
                throw new Error("PRIVATE_QUEUE_PROXY");
              },
            },
          ),
        ),
    ).toThrow("WORKER_QUEUE_INVALID");
  });

  it("atomically writes fixed status bytes without overwriting an existing status", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;

    await queue.writeStatus(claim, {
      schemaVersion: "worker-result-v1",
      status: "failed",
      errorCode: "CONVERSION_FAILED",
      retryable: false,
    });
    const statusPath = join(claim.directory, "status.json");
    expect(JSON.parse(await readFile(statusPath, "utf8"))).toEqual({
      errorCode: "CONVERSION_FAILED",
      retryable: false,
      schemaVersion: "worker-result-v1",
      status: "failed",
    });
    expect((await lstat(statusPath)).mode & 0o777).toBe(0o640);
    await expect(
      queue.writeStatus(claim, {
        schemaVersion: "worker-result-v1",
        status: "cancelled",
      }),
    ).rejects.toThrow("WORKER_QUEUE_INVALID");
  });

  it("reads exact claimed bytes and atomically publishes a bounded success", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;

    const input = await queue.readClaim(claim);
    expect([...input.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(input.manifest.jobId).toBe(FIRST_JOB);
    await queue.publishSuccess(claim, Uint8Array.of(0x25, 0x50, 0x44, 0x46), "application/pdf");

    expect(await readdir(join(root, "running"))).toEqual([]);
    expect(await readdir(join(root, "outbox", FIRST_JOB))).toEqual([
      "input.bin",
      "manifest.json",
      "result.bin",
      "status.json",
    ]);
  });

  it.each(RESULT_MEDIA_TYPES)("publishes the canonical %s result media", async (mediaType) => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;

    await queue.publishSuccess(claim, Uint8Array.of(0x78), mediaType);

    const status = JSON.parse(
      await readFile(join(root, "outbox", FIRST_JOB, "status.json"), "utf8"),
    );
    expect(status.mediaType).toBe(mediaType);
  });

  it("keeps manifest and status semantics under JSON and Array prototype replacement", async () => {
    const root = await privateRoot();
    await createQueued(root, FIRST_JOB);
    const queue = new WorkerQueue(root, { workerGid });
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const originalParse = JSON.parse;
    const originalIncludes = Array.prototype.includes;
    let observedJobId: string | undefined;
    let outbox: string[] = [];
    try {
      JSON.parse = () => {
        throw new Error("PRIVATE_JSON_REPLACEMENT");
      };
      Array.prototype.includes = function poisonedIncludes(value: unknown, fromIndex?: number) {
        if (
          value === "schemaVersion" ||
          value === "status" ||
          value === "mediaType" ||
          value === "resultBytes"
        ) {
          throw new Error("PRIVATE_ARRAY_REPLACEMENT");
        }
        return Reflect.apply(originalIncludes, this, [value, fromIndex]);
      };
      observedJobId = (await queue.readClaim(claim)).manifest.jobId;
      await queue.publishSuccess(claim, Uint8Array.of(0x25, 0x50, 0x44, 0x46), "application/pdf");
      outbox = await readdir(join(root, "outbox"));
    } finally {
      JSON.parse = originalParse;
      Array.prototype.includes = originalIncludes;
    }
    expect(observedJobId).toBe(FIRST_JOB);
    expect(outbox).toEqual([FIRST_JOB]);
  });
});
