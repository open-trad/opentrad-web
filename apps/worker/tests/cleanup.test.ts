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
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClaimLeaseOptions,
  recoverStaleRunningClaims,
  startClaimLease,
} from "../src/cleanup.js";
import { WorkerQueue } from "../src/queue.js";

const roots: string[] = [];
const workerGid = process.getgid?.() ?? 0;
const JOB_ID = "00000000-0000-4000-8000-000000000040";

async function fixture(): Promise<{ queue: WorkerQueue; root: string }> {
  const parent = await mkdtemp(join(tmpdir(), "opentrad-worker-cleanup-"));
  roots.push(parent);
  const root = join(parent, "jobs");
  await mkdir(root, { mode: 0o710 });
  await chmod(root, 0o710);
  for (const state of ["queued", "running", "outbox"]) {
    await mkdir(join(root, state), { mode: 0o2770 });
    await chmod(join(root, state), 0o2770);
  }
  await mkdir(join(root, "control"), { mode: 0o750 });
  await chmod(join(root, "control"), 0o750);
  const directory = join(root, "queued", JOB_ID);
  await mkdir(directory, { mode: 0o2770 });
  await chmod(directory, 0o2770);
  await writeFile(join(directory, "input.bin"), Uint8Array.of(0x78), { mode: 0o640 });
  await chmod(join(directory, "input.bin"), 0o640);
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: "server-v1",
      jobId: JOB_ID,
      operation: "office.to.pdf",
      inputFormat: "docx",
      outputFormat: "pdf",
      options: {},
      inputBytes: 1,
    })}\n`,
    { mode: 0o640 },
  );
  await chmod(join(directory, "manifest.json"), 0o640);
  const canonical = await realpath(root);
  return { queue: new WorkerQueue(canonical, { workerGid }), root: canonical };
}

function options(input: Partial<ClaimLeaseOptions> = {}): ClaimLeaseOptions {
  return {
    clearInterval: input.clearInterval ?? clearInterval,
    heartbeatMs: input.heartbeatMs ?? 30_000,
    now: input.now ?? (() => Date.now()),
    setInterval: input.setInterval ?? setInterval,
    workerGid,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("worker running-claim recovery", () => {
  it("does not invoke accessor lease options", async () => {
    const { queue } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    let getterCalls = 0;
    const hostile = {
      clearInterval,
      heartbeatMs: 30_000,
      now: Date.now,
      setInterval,
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "workerGid", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("PRIVATE_LEASE_OPTION");
      },
    });

    await expect(startClaimLease(claim, hostile as unknown as ClaimLeaseOptions)).rejects.toThrow(
      "WORKER_CLEANUP_INVALID",
    );
    expect(getterCalls).toBe(0);
  });

  it("writes and removes one private fixed lease without changing input entries", async () => {
    const { queue } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;

    const lease = await startClaimLease(claim, options({ now: () => 1_000 }));
    expect(JSON.parse(await readFile(join(claim.directory, ".lease.json"), "utf8"))).toMatchObject({
      heartbeatAt: 1_000,
      jobId: JOB_ID,
      schemaVersion: "worker-lease-v1",
    });
    expect(await readdir(claim.directory)).toEqual([".lease.json", "input.bin", "manifest.json"]);
    await lease.stop();
    expect(await readdir(claim.directory)).toEqual(["input.bin", "manifest.json"]);
  });

  it("does not recover a fresh active lease", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    await startClaimLease(claim, options({ now: () => 100_000 }));

    await expect(
      recoverStaleRunningClaims(root, 100_000 + 299_999, { workerGid, settleMs: 0 }),
    ).resolves.toBe(0);
    expect((await lstat(claim.directory)).isDirectory()).toBe(true);
  });

  it("atomically recovers one stale lease, removes known partials, and requeues", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const lease = await startClaimLease(claim, options({ now: () => 1_000 }));
    lease.stopHeartbeat();
    await writeFile(join(claim.directory, "result.bin.tmp"), "PRIVATE_RESULT", { mode: 0o640 });
    await chmod(join(claim.directory, "result.bin.tmp"), 0o640);

    await expect(
      recoverStaleRunningClaims(root, 301_000, { workerGid, settleMs: 0 }),
    ).resolves.toBe(1);

    expect(await readdir(join(root, "running"))).toEqual([]);
    expect(await readdir(join(root, "queued", JOB_ID))).toEqual(["input.bin", "manifest.json"]);
  });

  it("finishes a stale complete status handoff instead of rerunning conversion", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const lease = await startClaimLease(claim, options({ now: () => 1_000 }));
    lease.stopHeartbeat();
    await writeFile(join(claim.directory, "result.bin"), "%PDF", { mode: 0o640 });
    await chmod(join(claim.directory, "result.bin"), 0o640);
    await writeFile(
      join(claim.directory, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    await chmod(join(claim.directory, "status.json"), 0o640);

    expect(await recoverStaleRunningClaims(root, 301_000, { workerGid, settleMs: 0 })).toBe(1);
    expect(await readdir(join(root, "running"))).toEqual([]);
    expect(await readdir(join(root, "outbox", JOB_ID))).toEqual([
      "input.bin",
      "manifest.json",
      "result.bin",
      "status.json",
    ]);
  });

  it("recovers a restart orphan with no lease only after the stale threshold", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    await utimes(claim.directory, new Date(1_000), new Date(1_000));

    expect(await recoverStaleRunningClaims(root, 300_999, { workerGid, settleMs: 0 })).toBe(0);
    expect(await recoverStaleRunningClaims(root, 301_000, { workerGid, settleMs: 0 })).toBe(1);
  });

  it("fails closed without requeueing unknown files", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    await writeFile(join(claim.directory, "private-name.txt"), "PRIVATE", { mode: 0o640 });
    await utimes(claim.directory, new Date(1_000), new Date(1_000));

    await expect(
      recoverStaleRunningClaims(root, 301_000, { workerGid, settleMs: 0 }),
    ).rejects.toThrow("WORKER_CLEANUP_INVALID");
    expect((await lstat(claim.directory)).isDirectory()).toBe(true);
  });

  it("fails closed without requeueing linked input", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    await rm(join(claim.directory, "input.bin"));
    await symlink("/etc/passwd", join(claim.directory, "input.bin"));
    await utimes(claim.directory, new Date(1_000), new Date(1_000));
    await expect(
      recoverStaleRunningClaims(root, 301_000, { workerGid, settleMs: 0 }),
    ).rejects.toThrow("WORKER_CLEANUP_INVALID");
  });

  it("never touches queued, outbox, control, or API-only state roots", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "control", `${JOB_ID}.cancel`), new Uint8Array(), { mode: 0o640 });
    const outboxSentinel = join(root, "outbox", "00000000-0000-4000-8000-000000000041");
    await mkdir(outboxSentinel, { mode: 0o2770 });
    await chmod(outboxSentinel, 0o2770);

    expect(await recoverStaleRunningClaims(root, 999_999, { workerGid, settleMs: 0 })).toBe(0);
    expect(await readdir(join(root, "queued"))).toEqual([JOB_ID]);
    expect(await readdir(join(root, "outbox"))).toEqual(["00000000-0000-4000-8000-000000000041"]);
    expect(await readdir(join(root, "control"))).toEqual([`${JOB_ID}.cancel`]);
  });
});
