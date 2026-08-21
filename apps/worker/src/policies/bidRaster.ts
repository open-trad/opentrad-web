import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { isProxy } from "node:util/types";
import type { AttachmentPageImage } from "@opentrad/document-renderer";
import { inspectBidRasterJpegBytes } from "../adapters/bidAttachmentInspector.js";
import {
  createInternalProcessSpec,
  type InternalProcessSpec,
  runCommand,
} from "../processRunner.js";
import {
  type CanonicalBidArchive,
  copyCanonicalBidAttachmentBytes,
  copyCanonicalBidDraftBytes,
  copyExactUint8Array,
} from "./bidArchive.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PAGE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 80;
const DEADLINE_MS = 300_000;
const COMMAND_STOP_GRACE_MS = 2_750;
const CLEANUP_TIMEOUT_MS = 2_500;
const RuntimeError = Error;
const RASTER_FILE_NAME =
  /^(?:source-[0-9]{3}\.(?:pdf|png|jpg)|attachment-[0-9]{3}-page-[0-9]{3}(?:-raw)?\.jpg)$/u;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicClearTimeout = clearTimeout;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicReflectApply = Reflect.apply;
const intrinsicSetTimeout = setTimeout;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringStartsWith = String.prototype.startsWith;

interface BidRasterRuntime {
  readonly now: () => number;
  readonly read: (path: string, maximumBytes: number) => Promise<unknown>;
  readonly remove: (path: string) => Promise<void>;
  readonly run: (spec: InternalProcessSpec, signal: AbortSignal) => Promise<void>;
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
}

const runtimeBrand = new WeakSet<object>();

function fail(): never {
  throw new RuntimeError("CONVERSION_FAILED");
}

function exactRuntime(input: unknown): BidRasterRuntime {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) fail();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const expected = ["now", "read", "remove", "run", "write"];
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string" || !expected.includes(key))
    ) {
      fail();
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of expected) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
        fail();
      }
      Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    Object.freeze(output);
    runtimeBrand.add(output);
    return output as unknown as BidRasterRuntime;
  } catch {
    fail();
  }
}

/** Test-only runtime seam. Deliberately omitted from the package barrel. */
export function createBidRasterRuntimeForTesting(input: unknown): BidRasterRuntime {
  return exactRuntime(input);
}

function exactFileRoot(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length < 2 ||
    input[0] !== "/" ||
    input[input.length - 1] === "/" ||
    input.includes("\0")
  ) {
    fail();
  }
  return input;
}

function parseRasterFilePath(root: string, path: unknown): readonly [string, string] {
  if (typeof path !== "string") fail();
  const prefix = `${root}/`;
  if (!(intrinsicReflectApply(intrinsicStringStartsWith, path, [prefix]) as boolean)) fail();
  const relative = intrinsicReflectApply(intrinsicStringSlice, path, [prefix.length]) as string;
  const segments = intrinsicReflectApply(intrinsicStringSplit, relative, ["/"]) as string[];
  if (
    segments.length !== 3 ||
    !segments[0] ||
    !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [segments[0]]) ||
    segments[1] !== "attachments" ||
    !segments[2] ||
    !intrinsicReflectApply(intrinsicRegExpTest, RASTER_FILE_NAME, [segments[2]])
  ) {
    fail();
  }
  return [`${root}/${segments[0]}`, `${root}/${segments[0]}/attachments`];
}

async function validateDirectory(path: string, create: boolean): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    info = await lstat(path);
  } catch {
    if (!create) fail();
    try {
      await mkdir(path, { mode: 0o700 });
      info = await lstat(path);
    } catch {
      fail();
    }
  }
  if (!info?.isDirectory() || info.isSymbolicLink()) fail();
}

async function validateRasterParent(root: string, path: unknown, create: boolean): Promise<string> {
  try {
    const [jobDirectory, attachmentsDirectory] = parseRasterFilePath(root, path);
    await validateDirectory(root, false);
    await validateDirectory(jobDirectory, create);
    await validateDirectory(attachmentsDirectory, create);
    return path as string;
  } catch {
    return fail();
  }
}

function createRasterFileRuntime(rootInput: unknown): BidRasterRuntime {
  const root = exactFileRoot(rootInput);
  return exactRuntime({
    now: Date.now,
    read: async (path: string, maximumBytes: number) => {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const validatedPath = await validateRasterParent(root, path, false);
        handle = await open(validatedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const info = await handle.stat();
        if (
          !info.isFile() ||
          !Number.isSafeInteger(info.size) ||
          info.size < 1 ||
          info.size > maximumBytes ||
          (info.mode & 0o007) !== 0
        ) {
          fail();
        }
        const output = new Uint8Array(info.size);
        let offset = 0;
        while (offset < output.byteLength) {
          const result = await handle.read(output, offset, output.byteLength - offset, offset);
          if (result.bytesRead < 1) fail();
          offset += result.bytesRead;
        }
        const extra = await handle.read(new Uint8Array(1), 0, 1, offset);
        if (extra.bytesRead !== 0) fail();
        return output;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
    remove: async (path: string) => {
      try {
        const validatedPath = await validateRasterParent(root, path, false);
        await rm(validatedPath, { force: true });
      } catch {
        fail();
      }
    },
    run: runCommand,
    write: async (path: string, bytes: Uint8Array) => {
      const validatedPath = await validateRasterParent(root, path, true);
      const handle = await open(
        validatedPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
          if (result.bytesWritten < 1) fail();
          offset += result.bytesWritten;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  });
}

/** Test-only production file runtime seam. Deliberately omitted from the package barrel. */
export function createBidRasterFileRuntimeForTesting(root: unknown): BidRasterRuntime {
  return createRasterFileRuntime(root);
}

export function createBidRasterRuntime(...input: readonly unknown[]): BidRasterRuntime {
  if (input.length !== 0) fail();
  return createRasterFileRuntime("/work");
}

function readNow(runtime: BidRasterRuntime): number {
  const value = Reflect.apply(runtime.now, undefined, []) as unknown;
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function extension(mediaType: string): "pdf" | "png" | "jpg" {
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpg";
  return fail();
}

function numbered(value: number): string {
  return value < 10 ? `00${value}` : value < 100 ? `0${value}` : `${value}`;
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) fail();
}

async function executeRaster(
  archive: CanonicalBidArchive,
  jobId: string,
  callerSignal: AbortSignal | undefined,
  runtime: BidRasterRuntime,
  absoluteDeadlineInput?: number,
): Promise<readonly AttachmentPageImage[]> {
  if (!runtimeBrand.has(runtime) || !JOB_ID.test(jobId) || callerSignal?.aborted) fail();
  copyCanonicalBidDraftBytes(archive);
  const startedAt = readNow(runtime);
  if (startedAt > Number.MAX_SAFE_INTEGER - DEADLINE_MS) fail();
  const maximumDeadline = startedAt + DEADLINE_MS;
  const deadline = absoluteDeadlineInput ?? maximumDeadline;
  if (!Number.isSafeInteger(deadline) || deadline <= startedAt || deadline > maximumDeadline) {
    fail();
  }
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = intrinsicSetTimeout(() => controller.abort(), deadline - startedAt);
  const operationSignal = controller.signal;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    operationSignal.addEventListener("abort", () => reject(new RuntimeError("CONVERSION_FAILED")), {
      once: true,
    });
  });
  void abortPromise.catch(() => undefined);
  let cleanupAllowed = true;
  let activePending: Promise<unknown> | undefined;
  const settleWithin = async <T>(
    pending: Promise<T>,
    timeoutMs: number,
  ): Promise<"fulfilled" | "rejected" | "timeout"> => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending.then(
          () => "fulfilled" as const,
          () => "rejected" as const,
        ),
        new Promise<"timeout">((resolve) => {
          settleTimer = intrinsicSetTimeout(() => resolve("timeout"), timeoutMs);
        }),
      ]);
    } finally {
      if (settleTimer) intrinsicClearTimeout(settleTimer);
    }
  };
  const begin = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = Promise.resolve(operation());
    activePending = pending;
    void pending.then(
      () => {
        if (activePending === pending) activePending = undefined;
      },
      () => {
        if (activePending === pending) activePending = undefined;
      },
    );
    return pending;
  };
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    checkSignal(operationSignal);
    if (readNow(runtime) >= deadline) fail();
    const pending = begin(operation);
    const value = await Promise.race([pending, abortPromise]);
    checkSignal(operationSignal);
    if (readNow(runtime) >= deadline) fail();
    return value;
  };
  const boundedCommand = async (operation: () => Promise<void>): Promise<void> => {
    checkSignal(operationSignal);
    if (readNow(runtime) >= deadline) fail();
    const pending = begin(operation);
    try {
      const value = await Promise.race([pending, abortPromise]);
      checkSignal(operationSignal);
      if (readNow(runtime) >= deadline) fail();
      return value;
    } catch {
      if (
        operationSignal.aborted &&
        (await settleWithin(pending, COMMAND_STOP_GRACE_MS)) === "timeout"
      ) {
        cleanupAllowed = false;
      }
      fail();
    }
  };

  const root = `/work/${jobId}/attachments`;
  const knownPaths: string[] = [];
  const sources: Array<{
    readonly attachment: CanonicalBidArchive["attachments"][number];
    readonly bytes: Uint8Array;
    readonly index: number;
    readonly path: string;
  }> = [];
  for (let index = 0; index < archive.attachments.length; index += 1) {
    const attachment = archive.attachments[index];
    if (!attachment) fail();
    intrinsicReflectApply(intrinsicArrayPush, sources, [
      {
        attachment,
        bytes: copyCanonicalBidAttachmentBytes(archive, index, attachment.id),
        index,
        path: `${root}/source-${numbered(index)}.${extension(attachment.mediaType)}`,
      },
    ]);
  }
  const images: AttachmentPageImage[] = [];
  let totalBytes = 0;
  let cleanupFailed = false;
  try {
    for (const source of sources) {
      intrinsicReflectApply(intrinsicArrayPush, knownPaths, [source.path]);
      await bounded(
        () =>
          intrinsicReflectApply(runtime.write, undefined, [
            source.path,
            copyExactUint8Array(source.bytes, MAX_PAGE_BYTES),
          ]) as Promise<void>,
      );
    }
    for (const source of sources) {
      const { attachment } = source;
      if (attachment.mediaType === "application/pdf") {
        await boundedCommand(
          () =>
            Reflect.apply(runtime.run, undefined, [
              createInternalProcessSpec(
                "pdfinfo",
                ["-box", "-f", "1", "-l", `${attachment.pageCount}`, source.path],
                30_000,
                "base",
              ),
              operationSignal,
            ]) as Promise<void>,
        );
      }
      if (!attachment.includedInSubmission) continue;
      const pageCount = attachment.pageCount;
      if (
        !Number.isSafeInteger(pageCount) ||
        pageCount < 1 ||
        images.length + pageCount > MAX_PAGES
      ) {
        fail();
      }
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const prefix = `${root}/attachment-${numbered(source.index)}-page-${numbered(pageNumber)}`;
        const rawPath = `${prefix}-raw.jpg`;
        const finalPath = `${prefix}.jpg`;
        intrinsicReflectApply(intrinsicArrayPush, knownPaths, [finalPath]);
        if (attachment.mediaType === "application/pdf") {
          intrinsicReflectApply(intrinsicArrayPush, knownPaths, [rawPath]);
          const rawStem = intrinsicReflectApply(intrinsicStringSlice, rawPath, [0, -4]) as string;
          await boundedCommand(
            () =>
              Reflect.apply(runtime.run, undefined, [
                createInternalProcessSpec(
                  "pdftoppm",
                  [
                    "-jpeg",
                    "-r",
                    "180",
                    "-f",
                    `${pageNumber}`,
                    "-l",
                    `${pageNumber}`,
                    "-singlefile",
                    source.path,
                    rawStem,
                  ],
                  180_000,
                  "base",
                ),
                operationSignal,
              ]) as Promise<void>,
          );
        }
        const vipsInput = attachment.mediaType === "application/pdf" ? rawPath : source.path;
        await boundedCommand(
          () =>
            Reflect.apply(runtime.run, undefined, [
              createInternalProcessSpec(
                "vips",
                ["copy", vipsInput, `${finalPath}[Q=90,strip]`],
                60_000,
                "image",
              ),
              operationSignal,
            ]) as Promise<void>,
        );
        const raw = await bounded(
          () =>
            Reflect.apply(runtime.read, undefined, [finalPath, MAX_PAGE_BYTES]) as Promise<unknown>,
        );
        const bytes = copyExactUint8Array(raw, MAX_PAGE_BYTES);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_TOTAL_BYTES) fail();
        const dimensions = inspectBidRasterJpegBytes(bytes);
        intrinsicReflectApply(intrinsicArrayPush, images, [
          Object.freeze({
            attachmentId: attachment.id,
            pageNumber,
            bytes,
            widthPixels: dimensions.widthPixels,
            heightPixels: dimensions.heightPixels,
          }),
        ]);
      }
    }
    return Object.freeze(images);
  } finally {
    intrinsicClearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    if (cleanupAllowed && activePending) {
      if ((await settleWithin(activePending, COMMAND_STOP_GRACE_MS)) === "timeout") {
        cleanupAllowed = false;
      }
    }
    if (cleanupAllowed) {
      for (let index = knownPaths.length - 1; index >= 0; index -= 1) {
        const path = knownPaths[index];
        if (!path) continue;
        try {
          const removal = Reflect.apply(runtime.remove, undefined, [path]) as Promise<void>;
          if ((await settleWithin(removal, CLEANUP_TIMEOUT_MS)) !== "fulfilled") {
            cleanupFailed = true;
          }
        } catch {
          cleanupFailed = true;
        }
      }
    } else {
      cleanupFailed = true;
    }
    if (cleanupFailed) fail();
  }
}

export async function rasterizeBidAttachments(
  archive: CanonicalBidArchive,
  jobId: string,
  signal: AbortSignal | undefined,
  runtime: BidRasterRuntime,
  absoluteDeadline?: number,
): Promise<readonly AttachmentPageImage[]> {
  try {
    return await executeRaster(archive, jobId, signal, runtime, absoluteDeadline);
  } catch {
    throw new RuntimeError("CONVERSION_FAILED");
  }
}
