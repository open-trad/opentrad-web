import { isProxy } from "node:util/types";
import { createBidAttachmentArchiveRuntime } from "../adapters/bidAttachmentRuntime.js";
import { parseWorkerManifest } from "../manifest.js";
import {
  type CanonicalBidArchive,
  copyCanonicalBidDraftBytes,
  copyExactUint8Array,
  parseCanonicalBidArchive,
} from "./bidArchive.js";
import {
  type BidCompileSnapshot,
  compileCanonicalBidProject,
  createBidCompileRuntime,
} from "./bidCompile.js";
import { type RenderedBidDocument, renderCompiledBidDocument } from "./bidDocument.js";
import {
  copyFinalizedBidResultBytes,
  createBidFinalizeRuntime,
  type FinalizedBidResult,
  finalizeRenderedBidDocument,
} from "./bidFinalize.js";
import { createBidRasterRuntime, rasterizeBidAttachments } from "./bidRaster.js";

const MAX_ARCHIVE_BYTES = 52 * 1024 * 1024;
const DEADLINE_MS = 300_000;
const STAGE_DRAIN_MS = 2_750;
const AssemblyError = Error;
const intrinsicAbortAdd = AbortSignal.prototype.addEventListener;
const intrinsicAbortRemove = AbortSignal.prototype.removeEventListener;
const intrinsicClearTimeout = clearTimeout;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetTimeout = setTimeout;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

interface BidAssemblyRuntime {
  readonly compile: (
    archive: unknown,
    options: unknown,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
  readonly finalize: (
    rendered: unknown,
    jobId: string,
    outputFormat: "docx" | "pdf",
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
  readonly now: () => number;
  readonly parse: (
    bytes: Uint8Array,
    options: unknown,
    jobId: string,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
  readonly raster: (
    archive: unknown,
    jobId: string,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
  readonly render: (
    compiled: unknown,
    raster: unknown,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
}

const runtimeBrand = new WeakSet<object>();

function fail(): never {
  throw new AssemblyError("CONVERSION_FAILED");
}

function exactRuntime(input: unknown): BidAssemblyRuntime {
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
    const expected = ["compile", "finalize", "now", "parse", "raster", "render"] as const;
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
    return output as unknown as BidAssemblyRuntime;
  } catch {
    return fail();
  }
}

/** Test-only runtime seam. Deliberately omitted from the package barrel. */
export function createBidAssemblyRuntimeForTesting(input: unknown): BidAssemblyRuntime {
  return exactRuntime(input);
}

export function createBidAssemblyRuntime(...input: readonly unknown[]): BidAssemblyRuntime {
  if (input.length !== 0) fail();
  const compileRuntime = createBidCompileRuntime({ now: Date.now });
  const rasterRuntime = createBidRasterRuntime();
  const finalizeRuntime = createBidFinalizeRuntime();
  return exactRuntime({
    compile: async (archive: CanonicalBidArchive, options: unknown) =>
      compileCanonicalBidProject(copyCanonicalBidDraftBytes(archive), options, compileRuntime),
    finalize: async (
      rendered: RenderedBidDocument,
      jobId: string,
      outputFormat: "docx" | "pdf",
      signal: AbortSignal,
      deadline: number,
    ) =>
      finalizeRenderedBidDocument(rendered, jobId, outputFormat, signal, finalizeRuntime, deadline),
    now: Date.now,
    parse: async (
      bytes: Uint8Array,
      options: unknown,
      jobId: string,
      signal: AbortSignal,
      deadline: number,
    ) =>
      parseCanonicalBidArchive(
        bytes,
        options,
        signal,
        createBidAttachmentArchiveRuntime(jobId),
        deadline,
      ),
    raster: async (
      archive: CanonicalBidArchive,
      jobId: string,
      signal: AbortSignal,
      deadline: number,
    ) => rasterizeBidAttachments(archive, jobId, signal, rasterRuntime, deadline),
    render: async (compiled: BidCompileSnapshot, raster: unknown) =>
      renderCompiledBidDocument(compiled, raster),
  });
}

function readNow(runtime: BidAssemblyRuntime): number {
  let value: unknown;
  try {
    value = intrinsicReflectApply(runtime.now, undefined, []);
  } catch {
    return fail();
  }
  if (!intrinsicNumberIsSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

async function executeAssembly(
  input: unknown,
  manifestInput: unknown,
  signal: AbortSignal | undefined,
  runtime: BidAssemblyRuntime,
): Promise<FinalizedBidResult> {
  if (!intrinsicReflectApply(intrinsicWeakSetHas, runtimeBrand, [runtime])) fail();
  const manifest = parseWorkerManifest(manifestInput);
  if (
    manifest.operation !== "bid.assemble" ||
    manifest.inputFormat !== "opentrad" ||
    (manifest.outputFormat !== "docx" && manifest.outputFormat !== "pdf")
  ) {
    fail();
  }
  const bytes = copyExactUint8Array(input, MAX_ARCHIVE_BYTES);
  if (bytes.byteLength !== manifest.inputBytes) fail();
  const startedAt = readNow(runtime);
  if (startedAt > Number.MAX_SAFE_INTEGER - DEADLINE_MS) fail();
  const deadline = startedAt + DEADLINE_MS;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal?.aborted) fail();
  if (signal) {
    intrinsicReflectApply(intrinsicAbortAdd, signal, ["abort", onCallerAbort, { once: true }]);
  }
  const timer = intrinsicSetTimeout(() => controller.abort(), DEADLINE_MS);
  const operationSignal = controller.signal;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    intrinsicReflectApply(intrinsicAbortAdd, operationSignal, [
      "abort",
      () => reject(new AssemblyError("CONVERSION_FAILED")),
      { once: true },
    ]);
  });
  void abortPromise.catch(() => undefined);
  const settleWithin = async (pending: Promise<unknown>): Promise<boolean> => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => {
          settleTimer = intrinsicSetTimeout(() => resolve(false), STAGE_DRAIN_MS);
        }),
      ]);
    } finally {
      if (settleTimer) intrinsicClearTimeout(settleTimer);
    }
  };
  const stage = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (operationSignal.aborted || readNow(runtime) >= deadline) fail();
    const pending = operation();
    try {
      const value = await Promise.race([pending, abortPromise]);
      if (operationSignal.aborted || readNow(runtime) >= deadline) fail();
      return value;
    } catch {
      if (operationSignal.aborted) await settleWithin(pending);
      return fail();
    }
  };
  try {
    const archive = await stage(
      () =>
        intrinsicReflectApply(runtime.parse, undefined, [
          bytes,
          manifest.options,
          manifest.jobId,
          operationSignal,
          deadline,
        ]) as Promise<unknown>,
    );
    const compiled = await stage(
      () =>
        intrinsicReflectApply(runtime.compile, undefined, [
          archive,
          manifest.options,
          operationSignal,
          deadline,
        ]) as Promise<unknown>,
    );
    const raster = await stage(
      () =>
        intrinsicReflectApply(runtime.raster, undefined, [
          archive,
          manifest.jobId,
          operationSignal,
          deadline,
        ]) as Promise<unknown>,
    );
    const rendered = await stage(
      () =>
        intrinsicReflectApply(runtime.render, undefined, [
          compiled,
          raster,
          operationSignal,
          deadline,
        ]) as Promise<unknown>,
    );
    const finalized = await stage(
      () =>
        intrinsicReflectApply(runtime.finalize, undefined, [
          rendered,
          manifest.jobId,
          manifest.outputFormat,
          operationSignal,
          deadline,
        ]) as Promise<unknown>,
    );
    copyFinalizedBidResultBytes(finalized);
    return finalized as FinalizedBidResult;
  } finally {
    intrinsicClearTimeout(timer);
    if (signal) intrinsicReflectApply(intrinsicAbortRemove, signal, ["abort", onCallerAbort]);
  }
}

export async function assembleBidJob(
  input: unknown,
  manifestInput: unknown,
  signal: AbortSignal | undefined,
  runtime: BidAssemblyRuntime,
): Promise<FinalizedBidResult> {
  try {
    return await executeAssembly(input, manifestInput, signal, runtime);
  } catch {
    return fail();
  }
}
