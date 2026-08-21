import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { isProxy } from "node:util/types";
import { copyExactUint8Array } from "../policies/bidArchive.js";
import {
  createInternalProcessSpec,
  type InternalProcessSpec,
  runCommand,
} from "../processRunner.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_STATS_BYTES = 1024 * 1024;
const DECODE_FILE_NAME = /^(?:source-[0-9]{3}\.(?:png|jpg)|stats-[0-9]{3}\.v)$/u;
const DecodeError = Error;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

export interface BidImageDecodeRuntime {
  readonly now: () => number;
  readonly remove: (path: string) => Promise<void>;
  readonly removeTree: (path: string) => Promise<void>;
  readonly run: (spec: InternalProcessSpec, signal: AbortSignal) => Promise<void>;
  readonly verify: (path: string) => Promise<boolean>;
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
}

const runtimeBrand = new WeakSet<object>();

function fail(): never {
  throw new DecodeError("INVALID_REQUEST");
}

function exactRuntime(input: unknown): BidImageDecodeRuntime {
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
    const expected = ["now", "remove", "removeTree", "run", "verify", "write"] as const;
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== expected.length) fail();
    const output = intrinsicObjectCreate(null) as Record<string, unknown>;
    for (const key of expected) {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
        fail();
      }
      intrinsicObjectDefineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    intrinsicObjectFreeze(output);
    intrinsicReflectApply(intrinsicWeakSetAdd, runtimeBrand, [output]);
    return output as unknown as BidImageDecodeRuntime;
  } catch {
    return fail();
  }
}

/** Test-only runtime seam. Deliberately omitted from the package barrel. */
export function createBidImageDecodeRuntimeForTesting(input: unknown): BidImageDecodeRuntime {
  return exactRuntime(input);
}

function numbered(value: number): string {
  return value < 10 ? `00${value}` : value < 100 ? `0${value}` : `${value}`;
}

async function validateDirectory(path: string, create: boolean): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    info = await lstat(path);
  } catch {
    if (!create) fail();
    await mkdir(path, { mode: 0o700 });
    info = await lstat(path);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
}

function exactFileRoot(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length < 2 ||
    input[0] !== "/" ||
    input[input.length - 1] === "/" ||
    (intrinsicReflectApply(intrinsicStringIncludes, input, ["\0"]) as boolean)
  ) {
    fail();
  }
  return input;
}

function parseDecodePath(
  root: string,
  path: unknown,
): Readonly<{
  readonly inspectionDirectory: string;
  readonly jobDirectory: string;
  readonly path: string;
}> {
  if (typeof path !== "string") fail();
  const prefix = `${root}/`;
  if (!(intrinsicReflectApply(intrinsicStringStartsWith, path, [prefix]) as boolean)) fail();
  const relative = intrinsicReflectApply(intrinsicStringSlice, path, [prefix.length]) as string;
  const segments = intrinsicReflectApply(intrinsicStringSplit, relative, ["/"]) as string[];
  if (
    segments.length !== 3 ||
    !segments[0] ||
    !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [segments[0]]) ||
    segments[1] !== "inspection" ||
    !segments[2] ||
    !intrinsicReflectApply(intrinsicRegExpTest, DECODE_FILE_NAME, [segments[2]])
  ) {
    fail();
  }
  return intrinsicObjectFreeze({
    inspectionDirectory: `${root}/${segments[0]}/inspection`,
    jobDirectory: `${root}/${segments[0]}`,
    path,
  });
}

async function validateDecodeParent(
  root: string,
  path: unknown,
  create: boolean,
): Promise<ReturnType<typeof parseDecodePath>> {
  try {
    const parsed = parseDecodePath(root, path);
    await validateDirectory(root, false);
    await validateDirectory(parsed.jobDirectory, create);
    await validateDirectory(parsed.inspectionDirectory, create);
    return parsed;
  } catch {
    return fail();
  }
}

async function validateTree(path: string, depth = 0, budget = { value: 0 }): Promise<void> {
  if (depth > 16 || budget.value > 1_000) fail();
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
  for (const entry of await readdir(path, { withFileTypes: true })) {
    budget.value += 1;
    if (budget.value > 1_000 || entry.isSymbolicLink()) fail();
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await validateTree(child, depth + 1, budget);
    else if (!entry.isFile()) fail();
  }
}

function createFileRuntime(rootInput: unknown): BidImageDecodeRuntime {
  const root = exactFileRoot(rootInput);
  return exactRuntime({
    now: Date.now,
    remove: async (path: string) => {
      try {
        const parsed = await validateDecodeParent(root, path, false);
        await rm(parsed.path, { force: true });
      } catch {
        fail();
      }
    },
    removeTree: async (path: string) => {
      try {
        const parsed = parseDecodePath(root, `${path}/stats-000.v`);
        if (parsed.inspectionDirectory !== path) fail();
        await validateDirectory(root, false);
        await validateDirectory(parsed.jobDirectory, false);
        const info = await lstat(parsed.inspectionDirectory).catch(() => undefined);
        if (!info) return;
        await validateTree(parsed.inspectionDirectory);
        await rm(parsed.inspectionDirectory, { recursive: true, force: true });
      } catch {
        fail();
      }
    },
    run: runCommand,
    verify: async (path: string) => {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const parsed = await validateDecodeParent(root, path, false);
        handle = await open(parsed.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        await handle.chmod(0o600);
        const info = await handle.stat();
        return (
          info.isFile() &&
          info.size >= 1 &&
          info.size <= MAX_STATS_BYTES &&
          (info.mode & 0o777) === 0o600
        );
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
    write: async (path: string, input: Uint8Array) => {
      const bytes = copyExactUint8Array(input, MAX_INPUT_BYTES);
      const parsed = await validateDecodeParent(root, path, true);
      const entries = await readdir(parsed.inspectionDirectory, { withFileTypes: true });
      if (entries.length !== 0) fail();
      const handle = await open(
        parsed.path,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || (info.mode & 0o777) !== 0o600) fail();
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
          if (written.bytesWritten < 1) fail();
          offset += written.bytesWritten;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  });
}

/** Test-only production file runtime seam. Deliberately omitted from the package barrel. */
export function createBidImageDecodeFileRuntimeForTesting(root: unknown): BidImageDecodeRuntime {
  return createFileRuntime(root);
}

export function createBidImageDecodeRuntime(...input: readonly unknown[]): BidImageDecodeRuntime {
  if (input.length !== 0) fail();
  return createFileRuntime("/work");
}

function readNow(runtime: BidImageDecodeRuntime): number {
  const value = intrinsicReflectApply(runtime.now, undefined, []);
  if (!intrinsicNumberIsSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

export async function decodeAttachedBidImage(
  input: unknown,
  mediaType: unknown,
  jobId: unknown,
  sequence: unknown,
  signal: AbortSignal | undefined,
  absoluteDeadline: unknown,
  runtime: BidImageDecodeRuntime,
): Promise<void> {
  try {
    if (
      !intrinsicReflectApply(intrinsicWeakSetHas, runtimeBrand, [runtime]) ||
      (mediaType !== "image/png" && mediaType !== "image/jpeg") ||
      typeof jobId !== "string" ||
      !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [jobId]) ||
      !intrinsicNumberIsSafeInteger(sequence) ||
      (sequence as number) < 0 ||
      (sequence as number) > 99 ||
      signal?.aborted
    ) {
      fail();
    }
    const bytes = copyExactUint8Array(input, MAX_INPUT_BYTES);
    const now = readNow(runtime);
    if (!intrinsicNumberIsSafeInteger(absoluteDeadline) || (absoluteDeadline as number) <= now) {
      fail();
    }
    const remaining = (absoluteDeadline as number) - now;
    const timeoutMs = remaining < 60_000 ? remaining : 60_000;
    const root = `/work/${jobId}/inspection`;
    const token = numbered(sequence as number);
    const source = `${root}/source-${token}.${mediaType === "image/png" ? "png" : "jpg"}`;
    const stats = `${root}/stats-${token}.v`;
    let cleanupFailed = false;
    try {
      await intrinsicReflectApply(runtime.write, undefined, [source, bytes]);
      await intrinsicReflectApply(runtime.run, undefined, [
        createInternalProcessSpec("vips", ["stats", source, stats], timeoutMs, "image"),
        signal ?? new AbortController().signal,
      ]);
      if (!(await intrinsicReflectApply(runtime.verify, undefined, [stats]))) fail();
    } finally {
      for (const path of [stats, source]) {
        try {
          await intrinsicReflectApply(runtime.remove, undefined, [path]);
        } catch {
          cleanupFailed = true;
        }
      }
      try {
        await intrinsicReflectApply(runtime.removeTree, undefined, [root]);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) fail();
    }
  } catch {
    return fail();
  }
}
