import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runClaim, type WorkerClaimRuntime } from "../src/main.js";
import { WorkerQueue } from "../src/queue.js";

const roots: string[] = [];
const workerGid = process.getgid?.() ?? 0;
const JOB_ID = "00000000-0000-4000-8000-000000000020";

async function fixture(): Promise<{ queue: WorkerQueue; root: string }> {
  const parent = await mkdtemp(join(tmpdir(), "opentrad-worker-cancel-"));
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

async function cancel(root: string): Promise<void> {
  await writeFile(join(root, "control", `${JOB_ID}.cancel`), new Uint8Array(), { mode: 0o640 });
  await chmod(join(root, "control", `${JOB_ID}.cancel`), 0o640);
}

function runtime(input: Partial<WorkerClaimRuntime> = {}): WorkerClaimRuntime {
  return {
    convert: input.convert ?? (async () => Object.freeze({ result: true })),
    now: input.now ?? (() => Date.now()),
    publish: input.publish ?? (async () => undefined),
    setInterval: input.setInterval ?? setInterval,
    clearInterval: input.clearInterval ?? clearInterval,
    settleTimeoutMs: input.settleTimeoutMs ?? 2_750,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("worker cancellation lifecycle", () => {
  it("does not invoke accessor runtime functions", async () => {
    const { queue } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    let getterCalls = 0;
    const hostile = runtime() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "convert", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("PRIVATE_RUNTIME_ACCESSOR");
      },
    });

    await expect(runClaim(claim, queue, hostile as unknown as WorkerClaimRuntime)).resolves.toBe(
      "failed",
    );
    expect(getterCalls).toBe(0);
  });

  it("does not start conversion when cancellation exists before claim execution", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    await cancel(root);
    const convert = vi.fn(async () => Object.freeze({}));

    await expect(runClaim(claim, queue, runtime({ convert }))).resolves.toBe("cancelled");

    expect(convert).not.toHaveBeenCalled();
    expect(await readdir(join(root, "running"))).toEqual([]);
    expect(await readdir(join(root, "outbox"))).toEqual([JOB_ID]);
    expect(JSON.parse(await readFile(join(root, "outbox", JOB_ID, "status.json"), "utf8"))).toEqual(
      {
        schemaVersion: "worker-result-v1",
        status: "cancelled",
      },
    );
  });

  it("propagates inflight cancellation to the conversion AbortSignal and clears polling", async () => {
    vi.useFakeTimers();
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    let observedAbort = false;
    let markConversionStarted: (() => void) | undefined;
    const conversionStarted = new Promise<void>((resolve) => {
      markConversionStarted = resolve;
    });
    const clear = vi.fn(clearInterval);
    const pending = runClaim(
      claim,
      queue,
      runtime({
        clearInterval: clear,
        convert: async (_claim, signal) =>
          new Promise((_resolve, reject) => {
            markConversionStarted?.();
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(new Error("private-conversion-detail"));
              },
              { once: true },
            );
          }),
      }),
    );
    await conversionStarted;
    await cancel(root);
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBe("cancelled");
    expect(observedAbort).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("checks cancellation again after conversion and before publishing success", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const publish = vi.fn(async () => undefined);

    const outcome = await runClaim(
      claim,
      queue,
      runtime({
        convert: async () => {
          await cancel(root);
          return Object.freeze({ result: true });
        },
        publish,
      }),
    );

    expect(outcome).toBe("cancelled");
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes success exactly once and leaves DB cancellation precedence to API reconciliation", async () => {
    const { queue } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const result = Object.freeze({ result: true });
    const publish = vi.fn(async () => undefined);

    await expect(
      runClaim(claim, queue, runtime({ convert: async () => result, publish })),
    ).resolves.toBe("succeeded");

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(claim, result, expect.any(AbortSignal));
  });

  it("publishes a fixed failed status without leaking conversion errors", async () => {
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;

    await expect(
      runClaim(
        claim,
        queue,
        runtime({ convert: async () => Promise.reject(new Error("PRIVATE_INPUT_NAME")) }),
      ),
    ).resolves.toBe("failed");

    const status = await readFile(join(root, "outbox", JOB_ID, "status.json"), "utf8");
    expect(status).toContain("CONVERSION_FAILED");
    expect(status).not.toContain("PRIVATE_INPUT_NAME");
  });

  it("retains a private running recovery state when cancelled work will not settle", async () => {
    vi.useFakeTimers();
    const { queue, root } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const pending = runClaim(
      claim,
      queue,
      runtime({ convert: async () => new Promise(() => {}), settleTimeoutMs: 2_750 }),
    );
    await cancel(root);
    await vi.advanceTimersByTimeAsync(250 + 2_750);

    await expect(pending).resolves.toBe("recovery");
    expect((await lstat(join(root, "running", JOB_ID))).isDirectory()).toBe(true);
    expect(await readdir(join(root, "outbox"))).toEqual([]);
  });

  it("fails finitely when polling setup throws and does not start conversion", async () => {
    const { queue } = await fixture();
    const claim = await queue.claimNext();
    expect(claim).not.toBeNull();
    if (!claim) return;
    const convert = vi.fn(async () => Object.freeze({}));

    await expect(
      runClaim(
        claim,
        queue,
        runtime({
          convert,
          setInterval: () => {
            throw new Error("PRIVATE_TIMER_SETUP");
          },
        }),
      ),
    ).resolves.toBe("failed");
    expect(convert).not.toHaveBeenCalled();
  });
});
