import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { isProxy } from "node:util/types";
import { DOCX_V2_MIME } from "@opentrad/document-renderer";
import { inspectBidAttachmentBytes } from "../adapters/bidAttachmentInspector.js";
import {
  createInternalProcessSpec,
  type InternalProcessSpec,
  runCommand,
} from "../processRunner.js";
import { copyExactUint8Array } from "./bidArchive.js";
import { copyRenderedBidDocumentBytes, type RenderedBidDocument } from "./bidDocument.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RESULT_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 80;
const DEADLINE_MS = 300_000;
const INSPECTION_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 2_500;
const TOOL_DRAIN_MS = 2_750;
const FinalizeError = Error;
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
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetTimeout = setTimeout;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

interface BidFinalizeRuntime {
  readonly inspectPdf: (
    bytes: Uint8Array,
    maximumPages: number,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<unknown>;
  readonly now: () => number;
  readonly read: (path: string, maximumBytes: number) => Promise<unknown>;
  readonly remove: (path: string) => Promise<void>;
  readonly removeTree: (path: string) => Promise<void>;
  readonly run: (spec: InternalProcessSpec, signal: AbortSignal) => Promise<void>;
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
}

export interface FinalizedBidResult {
  readonly attachmentPages: number;
  readonly bodyPages: number;
  readonly byteLength: number;
  readonly mediaType: "application/pdf" | typeof DOCX_V2_MIME;
  readonly pageCount: number;
  readonly schemaVersion: "bid-finalized-result-v1";
}

const runtimeBrand = new WeakSet<object>();
const finalizedBytes = new WeakMap<object, Uint8Array>();

function fail(): never {
  throw new FinalizeError("CONVERSION_FAILED");
}

function exactRuntime(input: unknown): BidFinalizeRuntime {
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
    const expected = ["inspectPdf", "now", "read", "remove", "removeTree", "run", "write"] as const;
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
    return output as unknown as BidFinalizeRuntime;
  } catch {
    return fail();
  }
}

/** Test-only runtime seam. Deliberately omitted from the package barrel. */
export function createBidFinalizeRuntimeForTesting(input: unknown): BidFinalizeRuntime {
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

function parseFinalizePath(
  root: string,
  path: unknown,
): Readonly<{
  readonly bidDirectory: string;
  readonly jobDirectory: string;
  readonly outputDirectory: string;
  readonly path: string;
}> {
  if (typeof path !== "string") fail();
  const prefix = `${root}/`;
  if (!(intrinsicReflectApply(intrinsicStringStartsWith, path, [prefix]) as boolean)) fail();
  const relative = intrinsicReflectApply(intrinsicStringSlice, path, [prefix.length]) as string;
  const segments = intrinsicReflectApply(intrinsicStringSplit, relative, ["/"]) as string[];
  if (
    (segments.length !== 3 && segments.length !== 4) ||
    !segments[0] ||
    !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [segments[0]]) ||
    segments[1] !== "bid"
  ) {
    fail();
  }
  if (
    (segments.length === 3 &&
      segments[2] !== "body.docx" &&
      segments[2] !== "result.pdf" &&
      segments[2] !== "libreoffice-profile") ||
    (segments.length === 4 && (segments[2] !== "lo-output" || segments[3] !== "body.pdf"))
  ) {
    fail();
  }
  const jobDirectory = `${root}/${segments[0]}`;
  const bidDirectory = `${jobDirectory}/bid`;
  return intrinsicObjectFreeze({
    bidDirectory,
    jobDirectory,
    outputDirectory: `${bidDirectory}/lo-output`,
    path,
  });
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

async function validateFinalizeParent(
  root: string,
  path: unknown,
  create: boolean,
): Promise<ReturnType<typeof parseFinalizePath>> {
  try {
    const parsed = parseFinalizePath(root, path);
    await validateDirectory(root, false);
    await validateDirectory(parsed.jobDirectory, create);
    await validateDirectory(parsed.bidDirectory, create);
    if (parsed.path === `${parsed.outputDirectory}/body.pdf`) {
      await validateDirectory(parsed.outputDirectory, create);
    }
    return parsed;
  } catch {
    return fail();
  }
}

async function validatePrivateTree(path: string, depth = 0, budget = { value: 0 }): Promise<void> {
  if (depth > 32 || budget.value > 10_000) fail();
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    budget.value += 1;
    if (budget.value > 10_000 || entry.isSymbolicLink()) fail();
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await validatePrivateTree(child, depth + 1, budget);
    else if (!entry.isFile()) fail();
  }
}

function createFileRuntime(rootInput: unknown): BidFinalizeRuntime {
  const root = exactFileRoot(rootInput);
  return exactRuntime({
    inspectPdf: async (
      bytes: Uint8Array,
      maximumPages: number,
      signal: AbortSignal,
      deadline: number,
    ) => inspectBidAttachmentBytes(bytes, "application/pdf", maximumPages, signal, deadline),
    now: Date.now,
    read: async (path: string, maximumBytes: number) => {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const parsed = await validateFinalizeParent(root, path, false);
        handle = await open(parsed.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const info = await handle.stat();
        if (
          !info.isFile() ||
          !intrinsicNumberIsSafeInteger(info.size) ||
          info.size < 1 ||
          info.size > maximumBytes ||
          (info.mode & 0o007) !== 0
        ) {
          fail();
        }
        const bytes = new Uint8Array(info.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
          if (read.bytesRead < 1) fail();
          offset += read.bytesRead;
        }
        const extra = await handle.read(new Uint8Array(1), 0, 1, offset);
        if (extra.bytesRead !== 0) fail();
        return bytes;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
    remove: async (path: string) => {
      try {
        const parsed = await validateFinalizeParent(root, path, false);
        await rm(parsed.path, { force: true });
      } catch {
        fail();
      }
    },
    removeTree: async (path: string) => {
      try {
        const parsed = await validateFinalizeParent(root, path, false);
        if (parsed.path !== `${parsed.bidDirectory}/libreoffice-profile`) fail();
        const info = await lstat(parsed.path).catch(() => undefined);
        if (info === undefined) return;
        await validatePrivateTree(parsed.path);
        await rm(parsed.path, { recursive: true, force: true });
      } catch {
        fail();
      }
    },
    run: runCommand,
    write: async (path: string, input: Uint8Array) => {
      const bytes = copyExactUint8Array(input, MAX_RESULT_BYTES);
      const parsed = await validateFinalizeParent(root, path, true);
      if (parsed.path === `${parsed.bidDirectory}/body.docx`) {
        await validateDirectory(parsed.outputDirectory, true);
      }
      const handle = await open(
        parsed.path,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
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
export function createBidFinalizeFileRuntimeForTesting(root: unknown): BidFinalizeRuntime {
  return createFileRuntime(root);
}

export function createBidFinalizeRuntime(...input: readonly unknown[]): BidFinalizeRuntime {
  if (input.length !== 0) fail();
  return createFileRuntime("/work");
}

function readNow(runtime: BidFinalizeRuntime): number {
  let value: unknown;
  try {
    value = intrinsicReflectApply(runtime.now, undefined, []);
  } catch {
    return fail();
  }
  if (!intrinsicNumberIsSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function ownNumber(input: object, key: string, minimum: number, maximum: number): number {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  const value = descriptor.value;
  if (!intrinsicNumberIsSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function pageCount(input: unknown, maximum: number): number {
  if (input === null || typeof input !== "object" || isProxy(input)) fail();
  const prototype = intrinsicObjectGetPrototypeOf(input);
  if (prototype !== intrinsicObjectPrototype && prototype !== null) fail();
  const keys = intrinsicReflectOwnKeys(input);
  if (keys.length !== 1 || keys[0] !== "pageCount") fail();
  return ownNumber(input, "pageCount", 1, maximum);
}

function checkPdfMagic(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    fail();
  }
}

async function executeFinalize(
  rendered: RenderedBidDocument,
  jobId: string,
  outputFormat: "docx" | "pdf",
  callerSignal: AbortSignal | undefined,
  runtime: BidFinalizeRuntime,
  absoluteDeadlineInput?: number,
): Promise<FinalizedBidResult> {
  if (
    !intrinsicReflectApply(intrinsicWeakSetHas, runtimeBrand, [runtime]) ||
    !intrinsicReflectApply(RegExp.prototype.test, JOB_ID, [jobId]) ||
    (outputFormat !== "docx" && outputFormat !== "pdf") ||
    callerSignal?.aborted
  ) {
    fail();
  }
  const docxBytes = copyRenderedBidDocumentBytes(rendered);
  const attachmentPages = ownNumber(rendered, "attachmentPages", 0, MAX_PAGES);
  const startedAt = readNow(runtime);
  if (startedAt > Number.MAX_SAFE_INTEGER - DEADLINE_MS) fail();
  const maximumDeadline = startedAt + DEADLINE_MS;
  const deadline = absoluteDeadlineInput ?? maximumDeadline;
  if (
    !intrinsicNumberIsSafeInteger(deadline) ||
    deadline <= startedAt ||
    deadline > maximumDeadline
  ) {
    fail();
  }
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    intrinsicReflectApply(intrinsicAbortAdd, callerSignal, [
      "abort",
      onCallerAbort,
      { once: true },
    ]);
  }
  const timer = intrinsicSetTimeout(() => controller.abort(), deadline - startedAt);
  const signal = controller.signal;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    intrinsicReflectApply(intrinsicAbortAdd, signal, [
      "abort",
      () => reject(new FinalizeError("CONVERSION_FAILED")),
      { once: true },
    ]);
  });
  void abortPromise.catch(() => undefined);
  const root = `/work/${jobId}/bid`;
  const docxPath = `${root}/body.docx`;
  const outputDirectory = `${root}/lo-output`;
  const convertedPdfPath = `${outputDirectory}/body.pdf`;
  const finalPdfPath = `${root}/result.pdf`;
  const profilePath = `${root}/libreoffice-profile`;
  const knownPaths = [docxPath, convertedPdfPath, finalPdfPath];
  let cleanupFailed = false;
  const check = (): void => {
    if (signal.aborted || readNow(runtime) >= deadline) fail();
  };
  const runTool = async (spec: InternalProcessSpec): Promise<void> => {
    const pending = intrinsicReflectApply(runtime.run, undefined, [spec, signal]) as Promise<void>;
    try {
      await Promise.race([pending, abortPromise]);
    } catch {
      if (signal.aborted) {
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            pending.then(
              () => undefined,
              () => undefined,
            ),
            new Promise<void>((resolve) => {
              drainTimer = intrinsicSetTimeout(resolve, TOOL_DRAIN_MS);
            }),
          ]);
        } finally {
          if (drainTimer) intrinsicClearTimeout(drainTimer);
        }
      }
      fail();
    }
    check();
  };
  const nextInspectionDeadline = (): number => {
    const current = readNow(runtime);
    if (current >= deadline || current > Number.MAX_SAFE_INTEGER - INSPECTION_TIMEOUT_MS) fail();
    const local = current + INSPECTION_TIMEOUT_MS;
    return local < deadline ? local : deadline;
  };
  try {
    check();
    await intrinsicReflectApply(runtime.write, undefined, [docxPath, docxBytes.slice()]);
    check();
    await runTool(
      createInternalProcessSpec(
        "libreoffice",
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--nofirststartwizard",
          `-env:UserInstallation=file://${profilePath}`,
          "--convert-to",
          "pdf",
          "--outdir",
          outputDirectory,
          docxPath,
        ],
        120_000,
        "libreoffice",
      ),
    );
    check();
    const convertedPdf = copyExactUint8Array(
      await intrinsicReflectApply(runtime.read, undefined, [convertedPdfPath, MAX_RESULT_BYTES]),
      MAX_RESULT_BYTES,
    );
    checkPdfMagic(convertedPdf);
    const convertedPageCount = pageCount(
      await intrinsicReflectApply(runtime.inspectPdf, undefined, [
        convertedPdf.slice(),
        MAX_PAGES,
        signal,
        nextInspectionDeadline(),
      ]),
      MAX_PAGES,
    );
    if (convertedPageCount <= attachmentPages) fail();
    await runTool(
      createInternalProcessSpec(
        "pdfinfo",
        ["-box", "-f", "1", "-l", `${convertedPageCount}`, convertedPdfPath],
        30_000,
        "base",
      ),
    );
    check();
    let resultBytes = docxBytes;
    if (outputFormat === "pdf") {
      await runTool(
        createInternalProcessSpec("qpdf", ["--check", convertedPdfPath], 30_000, "base"),
      );
      await runTool(
        createInternalProcessSpec(
          "qpdf",
          ["--warning-exit-0", "--object-streams=generate", convertedPdfPath, finalPdfPath],
          90_000,
          "base",
        ),
      );
      check();
      resultBytes = copyExactUint8Array(
        await intrinsicReflectApply(runtime.read, undefined, [finalPdfPath, MAX_RESULT_BYTES]),
        MAX_RESULT_BYTES,
      );
      checkPdfMagic(resultBytes);
      const finalPageCount = pageCount(
        await intrinsicReflectApply(runtime.inspectPdf, undefined, [
          resultBytes.slice(),
          MAX_PAGES,
          signal,
          nextInspectionDeadline(),
        ]),
        MAX_PAGES,
      );
      if (finalPageCount !== convertedPageCount) fail();
      await runTool(
        createInternalProcessSpec(
          "pdfinfo",
          ["-box", "-f", "1", "-l", `${finalPageCount}`, finalPdfPath],
          30_000,
          "base",
        ),
      );
    }
    check();
    const stored = copyExactUint8Array(resultBytes, MAX_RESULT_BYTES);
    const result = intrinsicObjectCreate(null) as FinalizedBidResult;
    for (const [key, value] of [
      ["attachmentPages", attachmentPages],
      ["bodyPages", convertedPageCount - attachmentPages],
      ["byteLength", stored.byteLength],
      ["mediaType", outputFormat === "pdf" ? "application/pdf" : DOCX_V2_MIME],
      ["pageCount", convertedPageCount],
      ["schemaVersion", "bid-finalized-result-v1"],
    ] as const) {
      intrinsicObjectDefineProperty(result, key, { enumerable: true, value });
    }
    intrinsicObjectFreeze(result);
    intrinsicReflectApply(intrinsicWeakMapSet, finalizedBytes, [result, stored]);
    return result;
  } finally {
    intrinsicClearTimeout(timer);
    if (callerSignal) {
      intrinsicReflectApply(intrinsicAbortRemove, callerSignal, ["abort", onCallerAbort]);
    }
    const settleCleanup = async (pending: Promise<void>): Promise<boolean> => {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          pending.then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((resolve) => {
            cleanupTimer = intrinsicSetTimeout(() => resolve(false), CLEANUP_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (cleanupTimer) intrinsicClearTimeout(cleanupTimer);
      }
    };
    for (let index = knownPaths.length - 1; index >= 0; index -= 1) {
      try {
        const removed = (await settleCleanup(
          intrinsicReflectApply(runtime.remove, undefined, [knownPaths[index]]) as Promise<void>,
        )) as boolean;
        if (!removed) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      const removed = await settleCleanup(
        intrinsicReflectApply(runtime.removeTree, undefined, [profilePath]) as Promise<void>,
      );
      if (!removed) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) fail();
  }
}

export async function finalizeRenderedBidDocument(
  rendered: RenderedBidDocument,
  jobId: string,
  outputFormat: "docx" | "pdf",
  signal: AbortSignal | undefined,
  runtime: BidFinalizeRuntime,
  absoluteDeadline?: number,
): Promise<FinalizedBidResult> {
  try {
    return await executeFinalize(rendered, jobId, outputFormat, signal, runtime, absoluteDeadline);
  } catch {
    return fail();
  }
}

export function copyFinalizedBidResultBytes(input: unknown): Uint8Array {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) fail();
    const stored = intrinsicReflectApply(intrinsicWeakMapGet, finalizedBytes, [input]);
    if (stored === undefined) fail();
    return copyExactUint8Array(stored, MAX_RESULT_BYTES);
  } catch {
    return fail();
  }
}
