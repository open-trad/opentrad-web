import { randomUUID } from "node:crypto";
import { constants as fsConstants, lstatSync, realpathSync } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isProxy } from "node:util/types";
import { requireQueueClaim } from "./queue.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STALE_MS = 5 * 60_000;
const CleanupError = Error;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicJsonParse = JSON.parse;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetTimeout = setTimeout;

export interface ClaimLeaseOptions {
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  readonly heartbeatMs: number;
  readonly now: () => number;
  readonly onFailure?: () => void;
  readonly setInterval: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setInterval>;
  readonly workerGid: number;
}

export interface ClaimLease {
  readonly stop: () => Promise<void>;
  readonly stopHeartbeat: () => void;
}

export interface RecoveryOptions {
  readonly settleMs?: number;
  readonly workerGid?: number;
}

function fail(): never {
  throw new CleanupError("WORKER_CLEANUP_INVALID");
}

function exactInteger(input: unknown, minimum: number, maximum: number): number {
  if (
    !intrinsicNumberIsSafeInteger(input) ||
    (input as number) < minimum ||
    (input as number) > maximum
  ) {
    fail();
  }
  return input as number;
}

function leaseOptions(input: unknown): ClaimLeaseOptions {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      isProxy(input) ||
      (intrinsicObjectGetPrototypeOf(input) !== intrinsicObjectPrototype &&
        intrinsicObjectGetPrototypeOf(input) !== null)
    ) {
      fail();
    }
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length < 5 || keys.length > 6) fail();
    const allowed = [
      "clearInterval",
      "heartbeatMs",
      "now",
      "onFailure",
      "setInterval",
      "workerGid",
    ];
    const values = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") fail();
      let known = false;
      for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
        if (key === allowed[allowedIndex]) known = true;
      }
      if (!known) fail();
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) fail();
      values[key] = descriptor.value;
    }
    if (
      typeof values.clearInterval !== "function" ||
      typeof values.now !== "function" ||
      typeof values.setInterval !== "function" ||
      (values.onFailure !== undefined && typeof values.onFailure !== "function")
    ) {
      fail();
    }
    exactInteger(values.workerGid, 0, 2_147_483_647);
    exactInteger(values.heartbeatMs, 1_000, 60_000);
    return values as unknown as ClaimLeaseOptions;
  } catch {
    return fail();
  }
}

function exactRoot(input: unknown): string {
  try {
    if (
      typeof input !== "string" ||
      input.length < 2 ||
      input.length > 4096 ||
      !isAbsolute(input) ||
      resolve(input) !== input ||
      input.includes("\0") ||
      realpathSync(input) !== input
    ) {
      fail();
    }
    const info = lstatSync(input);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o710) fail();
    return input;
  } catch {
    return fail();
  }
}

function sharedDirectory(path: string, workerGid: number): void {
  try {
    const info = lstatSync(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.gid !== workerGid ||
      (info.mode & 0o7777) !== 0o2770
    ) {
      fail();
    }
  } catch {
    fail();
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesWritten < 1) fail();
    offset += result.bytesWritten;
  }
}

async function writeLease(
  path: string,
  jobId: string,
  token: string,
  heartbeatAt: number,
  workerGid: number,
  exclusive: boolean,
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_NOFOLLOW |
        (exclusive ? fsConstants.O_EXCL : fsConstants.O_TRUNC),
      0o640,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.gid !== workerGid || (info.mode & 0o777) !== 0o640) fail();
    const bytes = Buffer.from(
      `${intrinsicJsonStringify({
        heartbeatAt,
        jobId,
        schemaVersion: "worker-lease-v1",
        token,
      })}\n`,
      "utf8",
    );
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
  } catch {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed lease failure.
    }
    fail();
  }
}

export async function startClaimLease(
  claimInput: unknown,
  optionInput: ClaimLeaseOptions,
): Promise<ClaimLease> {
  const claim = requireQueueClaim(claimInput);
  try {
    const options = leaseOptions(optionInput);
    const workerGid = exactInteger(options.workerGid, 0, 2_147_483_647);
    const heartbeatMs = exactInteger(options.heartbeatMs, 1_000, 60_000);
    if (
      typeof options.now !== "function" ||
      typeof options.setInterval !== "function" ||
      typeof options.clearInterval !== "function" ||
      (options.onFailure !== undefined && typeof options.onFailure !== "function")
    ) {
      fail();
    }
    const token = randomUUID();
    const path = join(claim.directory, ".lease.json");
    const now = exactInteger(
      intrinsicReflectApply(options.now, undefined, []),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    await writeLease(path, claim.jobId, token, now, workerGid, true);
    let stopped = false;
    let updating = false;
    let timer: ReturnType<typeof setInterval>;
    const heartbeat = () => {
      if (stopped || updating) return;
      updating = true;
      void (async () => {
        try {
          const value = exactInteger(
            intrinsicReflectApply(options.now, undefined, []),
            0,
            Number.MAX_SAFE_INTEGER,
          );
          await writeLease(path, claim.jobId, token, value, workerGid, false);
        } catch {
          stopped = true;
          try {
            if (options.onFailure) intrinsicReflectApply(options.onFailure, undefined, []);
          } catch {
            // The fixed recovery signal remains authoritative.
          }
        } finally {
          updating = false;
        }
      })();
    };
    try {
      timer = intrinsicReflectApply(options.setInterval, undefined, [heartbeat, heartbeatMs]);
    } catch {
      await rm(path, { force: true });
      return fail();
    }
    const stopHeartbeat = () => {
      if (stopped) return;
      stopped = true;
      try {
        intrinsicReflectApply(options.clearInterval, undefined, [timer]);
      } catch {
        // The lease file still prevents unsafe recovery until stop removes it.
      }
    };
    return intrinsicObjectFreeze({
      stop: async () => {
        stopHeartbeat();
        while (updating) await new Promise((resolve) => intrinsicSetTimeout(resolve, 0));
        await rm(path, { force: true });
      },
      stopHeartbeat,
    });
  } catch {
    return fail();
  }
}

async function leaseHeartbeat(path: string, jobId: string, workerGid: number): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.gid !== workerGid ||
      (info.mode & 0o777) !== 0o640 ||
      info.size > 512
    )
      fail();
    const bytes = Buffer.alloc(info.size);
    const read = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (read.bytesRead !== bytes.byteLength) fail();
    await handle.close();
    handle = undefined;
    const value = intrinsicJsonParse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      value.schemaVersion !== "worker-lease-v1" ||
      value.jobId !== jobId ||
      typeof value.token !== "string" ||
      !/^[0-9a-f-]{36}$/u.test(value.token)
    ) {
      fail();
    }
    return exactInteger(value.heartbeatAt, 0, Number.MAX_SAFE_INTEGER);
  } catch {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed cleanup error.
    }
    return fail();
  }
}

export async function recoverStaleRunningClaims(
  rootInput: unknown,
  nowInput: unknown,
  options: RecoveryOptions = {},
): Promise<number> {
  const root = exactRoot(rootInput);
  const now = exactInteger(nowInput, 0, Number.MAX_SAFE_INTEGER);
  const workerGid = exactInteger(options.workerGid ?? 10_100, 0, 2_147_483_647);
  const settleMs = exactInteger(options.settleMs ?? 2_750, 0, 10_000);
  const running = join(root, "running");
  const queued = join(root, "queued");
  const outbox = join(root, "outbox");
  sharedDirectory(running, workerGid);
  sharedDirectory(queued, workerGid);
  sharedDirectory(outbox, workerGid);
  let names: string[];
  try {
    names = await readdir(running);
    intrinsicReflectApply(intrinsicArraySort, names, []);
  } catch {
    return fail();
  }
  let recovered = 0;
  for (let index = 0; index < names.length; index += 1) {
    const jobId = names[index];
    if (!jobId || !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [jobId])) fail();
    const directory = join(running, jobId);
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.gid !== workerGid ||
      (info.mode & 0o7777) !== 0o2770
    )
      fail();
    const lease = join(directory, ".lease.json");
    const recovering = join(directory, ".lease.recovering");
    const leaseInfo = await lstat(lease).catch(() => undefined);
    const heartbeatAt = leaseInfo
      ? await leaseHeartbeat(lease, jobId, workerGid)
      : Math.trunc(info.mtimeMs);
    if (heartbeatAt > now - STALE_MS) continue;
    try {
      if (leaseInfo) {
        await rename(lease, recovering);
      } else {
        const handle = await open(
          recovering,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o640,
        );
        await handle.close();
      }
    } catch {
      continue;
    }
    if (settleMs > 0) await new Promise((resolve) => intrinsicSetTimeout(resolve, settleMs));
    const entries = await readdir(directory);
    const allowed = new Set([
      ".lease.recovering",
      "input.bin",
      "manifest.json",
      "result.bin",
      "result.bin.tmp",
      "status.json",
      "status.json.tmp",
    ]);
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      if (!entry || !allowed.has(entry)) fail();
      const entryInfo = await lstat(join(directory, entry));
      if (!entryInfo.isFile() || entryInfo.isSymbolicLink() || (entryInfo.mode & 0o007) !== 0)
        fail();
    }
    const completeStatus = entries.includes("status.json");
    const hasTemporary = entries.includes("result.bin.tmp") || entries.includes("status.json.tmp");
    if (completeStatus && !hasTemporary) {
      const hasResult = entries.includes("result.bin");
      if (entries.length !== (hasResult ? 5 : 4)) fail();
      await rm(recovering, { force: true });
      await rename(directory, join(outbox, jobId));
      recovered += 1;
      continue;
    }
    for (const entry of ["result.bin", "result.bin.tmp", "status.json", "status.json.tmp"]) {
      await rm(join(directory, entry), { force: true });
    }
    await rm(recovering, { force: true });
    const remaining = await readdir(directory);
    intrinsicReflectApply(intrinsicArraySort, remaining, []);
    if (remaining.length !== 2 || remaining[0] !== "input.bin" || remaining[1] !== "manifest.json")
      fail();
    for (const entry of remaining) {
      const entryInfo = await lstat(join(directory, entry));
      if (
        !entryInfo.isFile() ||
        entryInfo.isSymbolicLink() ||
        entryInfo.gid !== workerGid ||
        (entryInfo.mode & 0o777) !== 0o640
      ) {
        fail();
      }
    }
    await rename(directory, join(queued, jobId));
    recovered += 1;
  }
  return recovered;
}
