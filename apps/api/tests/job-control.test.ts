import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobFileError, JobFiles } from "../src/jobs/jobFiles.js";

const roots: string[] = [];
const workerGid = process.getgid?.() ?? 0;
const JOB_ID = "00000000-0000-4000-8000-000000000010";

function privateRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), "opentrad-job-control-"));
  chmodSync(parent, 0o700);
  roots.push(parent);
  return join(parent, "jobs");
}

async function* oneByte(): AsyncGenerator<Uint8Array> {
  yield Uint8Array.of(0x78);
}

async function runningJob(files: JobFiles, root: string): Promise<void> {
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
        // Consume the exact admission stream.
      }
      return "clean";
    },
    source: oneByte(),
  });
  await rename(files.queuedDirectory(JOB_ID), join(root, "running", JOB_ID));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("API-owned worker cancellation controls", () => {
  it("creates a group-readable but worker-nonwritable control directory", () => {
    const root = privateRoot();
    new JobFiles(root, { workerGid });

    const info = statSync(join(root, "control"));
    expect(info.mode & 0o777).toBe(0o750);
    expect(info.gid).toBe(workerGid);
    expect(info.isDirectory()).toBe(true);
  });

  it("atomically creates one fixed empty cancellation marker outside running", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await runningJob(files, root);

    await files.requestCancellation(JOB_ID);
    await files.requestCancellation(JOB_ID);

    const marker = join(root, "control", `${JOB_ID}.cancel`);
    expect(await readFile(marker)).toHaveLength(0);
    expect((await lstat(marker)).mode & 0o777).toBe(0o640);
    expect(await readdir(join(root, "running", JOB_ID))).toEqual(["input.bin", "manifest.json"]);
    expect(await readdir(join(root, "control"))).toEqual([`${JOB_ID}.cancel`]);
  });

  it("removes a cancellation marker only after reconciliation", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await runningJob(files, root);
    await files.requestCancellation(JOB_ID);

    await files.clearCancellation(JOB_ID);
    await files.clearCancellation(JOB_ID);

    await expect(lstat(join(root, "control", `${JOB_ID}.cancel`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails closed when the control marker is a symlink", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await runningJob(files, root);
    const target = join(root, "private-target");
    await rm(join(root, "control", `${JOB_ID}.cancel`), { force: true });
    symlinkSync(target, join(root, "control", `${JOB_ID}.cancel`));

    await expect(files.requestCancellation(JOB_ID)).rejects.toSatisfy(
      (error: unknown) => error instanceof JobFileError && error.code === "INVALID_REQUEST",
    );
  });

  it("does not create controls for absent, queued, or invalid jobs", async () => {
    const root = privateRoot();
    const files = new JobFiles(root, { workerGid });
    await expect(files.requestCancellation(JOB_ID)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
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
          // Consume the exact admission stream.
        }
        return "clean";
      },
      source: oneByte(),
    });
    await expect(files.requestCancellation(JOB_ID)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(files.requestCancellation("../private-name")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await readdir(join(root, "control"))).toEqual([]);
  });
});
