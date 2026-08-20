import rehypeParse from "rehype-parse";
import rehypeSanitize, { type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

const MiB = 1024 * 1024;
const IntrinsicError = Error;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicRegExpReplace = RegExp.prototype[Symbol.replace];
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringCodePointAt = String.prototype.codePointAt;
const intrinsicStringNormalize = String.prototype.normalize;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicTextEncode = IntrinsicTextEncoder.prototype.encode;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayByteLength = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const LINE_ENDINGS = /\r\n?/gu;

const mutableLimits = intrinsicObjectCreate(null) as {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxNodes: number;
  maxDepth: number;
};
mutableLimits.maxInputBytes = 10 * MiB;
mutableLimits.maxOutputBytes = 10 * MiB;
mutableLimits.maxNodes = 50_000;
mutableLimits.maxDepth = 128;

export const TEXT_CONVERSION_LIMITS = intrinsicFreeze(mutableLimits);

export type TextFormat = "txt" | "md" | "html";
export type TextEncoding = "utf-8" | "gb18030";

export type TextFailureCode =
  | "LOCAL_CONVERSION_CANCELLED"
  | "LOCAL_TEXT_CONVERSION_FAILED"
  | "LOCAL_TEXT_DECODE_FAILED"
  | "LOCAL_TEXT_ENCODING_MISMATCH"
  | "LOCAL_TEXT_FORMAT_INVALID"
  | "LOCAL_TEXT_INPUT_INVALID"
  | "LOCAL_TEXT_INPUT_TOO_LARGE"
  | "LOCAL_TEXT_INVALID_CHARACTERS"
  | "LOCAL_TEXT_NODE_LIMIT_EXCEEDED"
  | "LOCAL_TEXT_OUTPUT_TOO_LARGE";

const cancelledSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const conversionSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const decodeSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const mismatchSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const formatSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const inputSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const inputLimitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const characterSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const nodeLimitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const outputLimitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));

const SAFE_HTML_SCHEMA: SanitizeSchema = intrinsicFreeze({
  allowComments: false,
  allowDoctypes: false,
  attributes: {
    ol: ["start"],
    td: ["colSpan", "rowSpan"],
    th: ["colSpan", "rowSpan"],
  },
  protocols: {},
  strip: [
    "applet",
    "audio",
    "base",
    "embed",
    "form",
    "frame",
    "frameset",
    "iframe",
    "input",
    "link",
    "math",
    "meta",
    "noscript",
    "object",
    "script",
    "style",
    "svg",
    "template",
    "video",
  ],
  tagNames: [
    "a",
    "b",
    "blockquote",
    "br",
    "caption",
    "code",
    "dd",
    "del",
    "details",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "kbd",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "var",
  ],
});

export function raiseTextFailure(code: TextFailureCode): never {
  switch (code) {
    case "LOCAL_CONVERSION_CANCELLED":
      throw cancelledSentinel;
    case "LOCAL_TEXT_CONVERSION_FAILED":
      throw conversionSentinel;
    case "LOCAL_TEXT_DECODE_FAILED":
      throw decodeSentinel;
    case "LOCAL_TEXT_ENCODING_MISMATCH":
      throw mismatchSentinel;
    case "LOCAL_TEXT_FORMAT_INVALID":
      throw formatSentinel;
    case "LOCAL_TEXT_INPUT_INVALID":
      throw inputSentinel;
    case "LOCAL_TEXT_INPUT_TOO_LARGE":
      throw inputLimitSentinel;
    case "LOCAL_TEXT_INVALID_CHARACTERS":
      throw characterSentinel;
    case "LOCAL_TEXT_NODE_LIMIT_EXCEEDED":
      throw nodeLimitSentinel;
    case "LOCAL_TEXT_OUTPUT_TOO_LARGE":
      throw outputLimitSentinel;
  }
}

function publicTextError(error: unknown): Error {
  if (error === cancelledSentinel) return new IntrinsicError("LOCAL_CONVERSION_CANCELLED");
  if (error === decodeSentinel) return new IntrinsicError("LOCAL_TEXT_DECODE_FAILED");
  if (error === mismatchSentinel) return new IntrinsicError("LOCAL_TEXT_ENCODING_MISMATCH");
  if (error === formatSentinel) return new IntrinsicError("LOCAL_TEXT_FORMAT_INVALID");
  if (error === inputSentinel) return new IntrinsicError("LOCAL_TEXT_INPUT_INVALID");
  if (error === inputLimitSentinel) return new IntrinsicError("LOCAL_TEXT_INPUT_TOO_LARGE");
  if (error === characterSentinel) return new IntrinsicError("LOCAL_TEXT_INVALID_CHARACTERS");
  if (error === nodeLimitSentinel) return new IntrinsicError("LOCAL_TEXT_NODE_LIMIT_EXCEEDED");
  if (error === outputLimitSentinel) return new IntrinsicError("LOCAL_TEXT_OUTPUT_TOO_LARGE");
  return new IntrinsicError("LOCAL_TEXT_CONVERSION_FAILED");
}

export async function runTextBoundary<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw publicTextError(error);
  }
}

export function checkTextAbort(signal?: AbortSignal): void {
  if (signal?.aborted) raiseTextFailure("LOCAL_CONVERSION_CANCELLED");
}

export async function textCheckpoint(signal?: AbortSignal): Promise<void> {
  checkTextAbort(signal);
  await Promise.resolve();
  checkTextAbort(signal);
}

function validXmlCodePoint(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  return (
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

export function normalizeTextSource(value: string, signal?: AbortSignal): string {
  checkTextAbort(signal);
  if (typeof value !== "string") raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  if (value.length > TEXT_CONVERSION_LIMITS.maxInputBytes) {
    raiseTextFailure("LOCAL_TEXT_INPUT_TOO_LARGE");
  }
  let normalized: string;
  try {
    normalized = intrinsicReflectApply(intrinsicStringNormalize, value, ["NFKC"]);
    normalized = intrinsicReflectApply(intrinsicRegExpReplace, LINE_ENDINGS, [normalized, "\n"]);
  } catch {
    raiseTextFailure("LOCAL_TEXT_CONVERSION_FAILED");
  }
  if (normalized.length > TEXT_CONVERSION_LIMITS.maxInputBytes) {
    raiseTextFailure("LOCAL_TEXT_INPUT_TOO_LARGE");
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCodePointAt, normalized, [index]) as number;
    if (!validXmlCodePoint(code)) raiseTextFailure("LOCAL_TEXT_INVALID_CHARACTERS");
    if (code > 0xffff) index += 1;
    if ((index & 0x0fff) === 0) checkTextAbort(signal);
  }
  return (intrinsicReflectApply(intrinsicStringCharCodeAt, normalized, [0]) as number) === 0xfeff
    ? (intrinsicReflectApply(intrinsicStringSlice, normalized, [1]) as string)
    : normalized;
}

export function assertSyntaxTreeBudget(tree: unknown, signal?: AbortSignal): void {
  const stack: Array<{ readonly depth: number; readonly node: unknown }> = [
    { depth: 0, node: tree },
  ];
  let count = 0;
  while (stack.length > 0) {
    const entry = stack[stack.length - 1];
    stack.length -= 1;
    if (!entry || entry.node === null || typeof entry.node !== "object") continue;
    count += 1;
    if (count > TEXT_CONVERSION_LIMITS.maxNodes || entry.depth > TEXT_CONVERSION_LIMITS.maxDepth) {
      raiseTextFailure("LOCAL_TEXT_NODE_LIMIT_EXCEEDED");
    }
    if ((count & 0x00ff) === 0) checkTextAbort(signal);
    const children = (entry.node as { readonly children?: unknown }).children;
    if (!intrinsicArrayIsArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack[stack.length] = { depth: entry.depth + 1, node: children[index] };
    }
  }
}

export async function sanitizeHtmlInternal(value: string, signal?: AbortSignal): Promise<string> {
  const source = normalizeTextSource(value, signal);
  await textCheckpoint(signal);
  const parser = unified().use(rehypeParse, { fragment: true });
  const parsed = parser.parse(source);
  assertSyntaxTreeBudget(parsed, signal);
  await textCheckpoint(signal);
  const sanitized = await unified().use(rehypeSanitize, SAFE_HTML_SCHEMA).run(parsed);
  assertSyntaxTreeBudget(sanitized, signal);
  await textCheckpoint(signal);
  const output = unified().use(rehypeStringify).stringify(sanitized);
  checkTextAbort(signal);
  return output;
}

export async function sanitizeHtmlFragment(value: string, signal?: AbortSignal): Promise<string> {
  return runTextBoundary(async () => {
    const output = await sanitizeHtmlInternal(value, signal);
    encodeTextOutput(output);
    return output;
  });
}

export function encodeTextOutput(value: string): Uint8Array<ArrayBuffer> {
  let output: Uint8Array<ArrayBuffer>;
  try {
    output = intrinsicReflectApply(intrinsicTextEncode, new IntrinsicTextEncoder(), [
      value,
    ]) as Uint8Array<ArrayBuffer>;
  } catch {
    raiseTextFailure("LOCAL_TEXT_CONVERSION_FAILED");
  }
  if (
    !intrinsicTypedArrayByteLength ||
    (intrinsicReflectApply(intrinsicTypedArrayByteLength, output, []) as number) >
      TEXT_CONVERSION_LIMITS.maxOutputBytes
  ) {
    raiseTextFailure("LOCAL_TEXT_OUTPUT_TOO_LARGE");
  }
  return output;
}
