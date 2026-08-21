import { getDocument, PasswordException, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const INSPECTION_TIMEOUT_MS = 10_000;
const MAX_GRAPH_DEPTH = 32;
const MAX_GRAPH_VALUES = 10_000;

export type PdfInspectionErrorCode = "ENCRYPTED_INPUT" | "INVALID_REQUEST" | "PAGE_LIMIT_EXCEEDED";

export class PdfInspectionError extends Error {
  readonly code: PdfInspectionErrorCode;

  constructor(code: PdfInspectionErrorCode) {
    super(code);
    this.code = code;
  }
}

function invalid(): never {
  throw new PdfInspectionError("INVALID_REQUEST");
}

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map || value instanceof Set) return value.size > 0;
  if (typeof value === "object") return Reflect.ownKeys(value).length > 0;
  return true;
}

function activeGraph(value: unknown, depth = 0, budget: { value: number } = { value: 0 }): void {
  if (value === null || value === undefined) return;
  if (depth > MAX_GRAPH_DEPTH || budget.value > MAX_GRAPH_VALUES) invalid();
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) invalid();
      budget.value += 1;
      activeGraph(descriptor.value, depth + 1, budget);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") invalid();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid();
    const item = descriptor.value;
    const lowered = key.toLowerCase();
    if (
      (lowered === "action" ||
        lowered === "attachment" ||
        lowered === "file" ||
        lowered === "jsactions" ||
        lowered === "unsafeurl" ||
        lowered === "url") &&
      nonEmpty(item)
    ) {
      invalid();
    }
    budget.value += 1;
    activeGraph(item, depth + 1, budget);
  }
}

async function bounded<T>(promise: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) invalid();
  const remaining = deadline - Date.now();
  if (remaining <= 0) invalid();
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PdfInspectionError("INVALID_REQUEST")), remaining);
        if (signal) {
          abort = () => reject(new PdfInspectionError("INVALID_REQUEST"));
          signal.addEventListener("abort", abort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function inspectPdfBytes(
  input: Uint8Array,
  maximumPages: number,
  signal?: AbortSignal,
  absoluteDeadline = Date.now() + INSPECTION_TIMEOUT_MS,
): Promise<{ readonly pageCount: number }> {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength < 1 ||
    input.byteLength > MAX_PDF_BYTES ||
    !Number.isSafeInteger(maximumPages) ||
    maximumPages < 1 ||
    maximumPages > 80 ||
    !Number.isSafeInteger(absoluteDeadline) ||
    absoluteDeadline <= Date.now() ||
    signal?.aborted
  ) {
    invalid();
  }
  const bytes = new Uint8Array(input.byteLength);
  bytes.set(input);
  const parameters = {
    data: bytes,
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableScripting: false,
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  } as const;
  const task = getDocument(parameters);
  const deadline = absoluteDeadline;
  let document: Awaited<typeof task.promise> | undefined;
  try {
    document = await bounded(task.promise, deadline, signal);
    const pageCount = document.numPages;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) invalid();
    if (pageCount > maximumPages) throw new PdfInspectionError("PAGE_LIMIT_EXCEEDED");
    let pureXfa: unknown;
    let allXfa: unknown;
    try {
      pureXfa = document.isPureXfa;
      allXfa = document.allXfaHtml;
    } catch {
      return invalid();
    }
    if (pureXfa === true || nonEmpty(allXfa)) invalid();
    const attachments = await bounded(document.getAttachments(), deadline, signal);
    const scripts = await bounded(document.getJSActions(), deadline, signal);
    const openAction = await bounded(document.getOpenAction(), deadline, signal);
    const outline = await bounded(document.getOutline(), deadline, signal);
    if (nonEmpty(attachments) || nonEmpty(scripts) || nonEmpty(openAction)) invalid();
    activeGraph(outline);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await bounded(document.getPage(pageNumber), deadline, signal);
      try {
        const pageScripts = await bounded(page.getJSActions(), deadline, signal);
        const pageXfa = await bounded(page.getXfa(), deadline, signal);
        const annotations = await bounded(
          page.getAnnotations({ intent: "display" }),
          deadline,
          signal,
        );
        if (nonEmpty(pageScripts) || nonEmpty(pageXfa)) invalid();
        activeGraph(annotations);
      } finally {
        try {
          page.cleanup();
        } catch {
          invalid();
        }
      }
    }
    return Object.freeze({ pageCount });
  } catch (error) {
    if (error instanceof PdfInspectionError) throw error;
    if (error instanceof PasswordException) throw new PdfInspectionError("ENCRYPTED_INPUT");
    throw new PdfInspectionError("INVALID_REQUEST");
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
