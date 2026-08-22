import type { LocalConversionRequest } from "../protocol.js";
import type { LocalWorkerOutput } from "../worker.js";
import {
  assertSyntaxTreeBudget,
  checkTextAbort,
  encodeTextOutput,
  normalizeTextSource,
  raiseTextFailure,
  runTextBoundary,
  sanitizeHtmlInternal,
  TEXT_CONVERSION_LIMITS,
  type TextEncoding,
  type TextFormat,
  textCheckpoint,
} from "./semanticDocument.js";

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicError = Error;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicArrayJoin = Array.prototype.join;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicTextDecode = IntrinsicTextDecoder.prototype.decode;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLength = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;

interface MarkdownNode {
  readonly alt?: unknown;
  readonly children?: readonly MarkdownNode[];
  readonly depth?: unknown;
  readonly ordered?: unknown;
  readonly start?: unknown;
  readonly type?: unknown;
  readonly value?: unknown;
}

const MARKDOWN_OPTIONS = intrinsicFreeze({
  bullet: "-" as const,
  emphasis: "*" as const,
  fences: true,
  incrementListMarker: false,
  listItemIndent: "one" as const,
  rule: "-" as const,
  strong: "*" as const,
});

function isTextFormat(value: unknown): value is TextFormat {
  return value === "txt" || value === "md" || value === "html";
}

function isTextEncoding(value: unknown): value is TextEncoding {
  return value === "utf-8" || value === "gb18030";
}

function copyInputBytes(input: unknown): Uint8Array<ArrayBuffer> {
  if (
    input === null ||
    typeof input !== "object" ||
    intrinsicGetPrototypeOf(input) !== IntrinsicUint8Array.prototype ||
    !intrinsicTypedArrayBuffer ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicArrayBufferByteLength
  ) {
    raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  }
  const byteLength = intrinsicReflectApply(intrinsicTypedArrayByteLength, input, []) as number;
  const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, input, []) as unknown;
  if (
    !intrinsicNumberIsSafeInteger(byteLength) ||
    byteLength < 0 ||
    intrinsicGetPrototypeOf(buffer as object) !== IntrinsicArrayBuffer.prototype
  ) {
    raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  }
  if (byteLength > TEXT_CONVERSION_LIMITS.maxInputBytes) {
    raiseTextFailure("LOCAL_TEXT_INPUT_TOO_LARGE");
  }
  const bufferByteLength = intrinsicReflectApply(
    intrinsicArrayBufferByteLength,
    buffer,
    [],
  ) as number;
  if (!intrinsicNumberIsSafeInteger(bufferByteLength) || bufferByteLength < byteLength) {
    raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  }
  if (
    intrinsicArrayBufferResizable &&
    intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true
  ) {
    raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  }
  const copy = new IntrinsicUint8Array(byteLength);
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [input]);
  return copy;
}

function byteLength(bytes: Uint8Array<ArrayBuffer>): number {
  if (!intrinsicTypedArrayByteLength) raiseTextFailure("LOCAL_TEXT_INPUT_INVALID");
  return intrinsicReflectApply(intrinsicTypedArrayByteLength, bytes, []) as number;
}

function hasUtf8Bom(bytes: Uint8Array<ArrayBuffer>): boolean {
  return byteLength(bytes) >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function strictDecode(bytes: Uint8Array<ArrayBuffer>, encoding: TextEncoding): string {
  if (encoding === "gb18030" && hasUtf8Bom(bytes)) {
    raiseTextFailure("LOCAL_TEXT_ENCODING_MISMATCH");
  }
  try {
    return intrinsicReflectApply(
      intrinsicTextDecode,
      new IntrinsicTextDecoder(encoding, { fatal: true, ignoreBOM: false }),
      [bytes],
    ) as string;
  } catch {
    raiseTextFailure("LOCAL_TEXT_DECODE_FAILED");
  }
}

function escapeHtml(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
    switch (code) {
      case 0x26:
        output += "&#x26;";
        break;
      case 0x3c:
        output += "&#x3C;";
        break;
      case 0x3e:
        output += "&#x3E;";
        break;
      default:
        output += value[index] ?? "";
    }
  }
  return output;
}

function safeMarkdownNode(node: MarkdownNode, depth: number): MarkdownNode[] {
  if (depth > TEXT_CONVERSION_LIMITS.maxDepth || typeof node.type !== "string") {
    raiseTextFailure("LOCAL_TEXT_NODE_LIMIT_EXCEEDED");
  }
  const type = node.type;
  if (type === "html" || type === "definition") return [];
  if (type === "image" || type === "imageReference") {
    return typeof node.alt === "string" && node.alt.length > 0
      ? [{ type: "text", value: node.alt }]
      : [];
  }
  const children: MarkdownNode[] = [];
  if (node.children) {
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      if (!child) continue;
      const cleaned = safeMarkdownNode(child, depth + 1);
      for (let cleanIndex = 0; cleanIndex < cleaned.length; cleanIndex += 1) {
        const cleanChild = cleaned[cleanIndex];
        if (cleanChild) children[children.length] = cleanChild;
      }
    }
  }
  if (type === "link" || type === "linkReference") return children;
  switch (type) {
    case "root":
    case "paragraph":
    case "blockquote":
    case "listItem":
    case "emphasis":
    case "strong":
    case "delete":
      return [{ type, children }];
    case "heading":
      return [
        {
          type,
          depth:
            intrinsicNumberIsSafeInteger(node.depth) &&
            (node.depth as number) >= 1 &&
            (node.depth as number) <= 6
              ? node.depth
              : 1,
          children,
        },
      ];
    case "list":
      return [
        {
          type,
          ordered: node.ordered === true,
          start:
            intrinsicNumberIsSafeInteger(node.start) && (node.start as number) > 0
              ? node.start
              : undefined,
          children,
        },
      ];
    case "text":
    case "inlineCode":
    case "code":
      return [{ type, value: typeof node.value === "string" ? node.value : "" }];
    case "break":
    case "thematicBreak":
      return [{ type }];
    default:
      return children;
  }
}

async function markdownRuntime() {
  const [{ default: remarkParse }, { default: remarkStringify }, { unified }] = await Promise.all([
    import("remark-parse"),
    import("remark-stringify"),
    import("unified"),
  ]);
  return { remarkParse, remarkStringify, unified };
}

async function parseSafeMarkdown(source: string, signal?: AbortSignal): Promise<MarkdownNode> {
  checkTextAbort(signal);
  const { remarkParse, unified } = await markdownRuntime();
  const parsed = unified().use(remarkParse).parse(source) as MarkdownNode;
  assertSyntaxTreeBudget(parsed, signal);
  const cleaned = safeMarkdownNode(parsed, 0)[0];
  if (!cleaned || cleaned.type !== "root") raiseTextFailure("LOCAL_TEXT_CONVERSION_FAILED");
  assertSyntaxTreeBudget(cleaned, signal);
  return cleaned;
}

async function stringifyMarkdown(tree: MarkdownNode, signal?: AbortSignal): Promise<string> {
  checkTextAbort(signal);
  const { remarkStringify, unified } = await markdownRuntime();
  return unified()
    .use(remarkStringify, MARKDOWN_OPTIONS)
    .stringify(tree as never);
}

async function canonicalMarkdown(
  source: string,
  signal?: AbortSignal,
): Promise<{
  readonly markdown: string;
  readonly tree: MarkdownNode;
}> {
  const tree = await parseSafeMarkdown(source, signal);
  return { markdown: await stringifyMarkdown(tree, signal), tree };
}

function renderChildren(node: MarkdownNode, separator: string, signal?: AbortSignal): string {
  const output: string[] = [];
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child) intrinsicReflectApply(intrinsicArrayPush, output, [renderHtmlNode(child, signal)]);
  }
  return intrinsicReflectApply(intrinsicArrayJoin, output, [separator]) as string;
}

function renderHtmlNode(node: MarkdownNode, signal?: AbortSignal): string {
  checkTextAbort(signal);
  switch (node.type) {
    case "root":
      return renderChildren(node, "\n", signal);
    case "paragraph":
      return `<p>${renderChildren(node, "", signal)}</p>`;
    case "heading": {
      const depth = typeof node.depth === "number" ? node.depth : 1;
      return `<h${depth}>${renderChildren(node, "", signal)}</h${depth}>`;
    }
    case "blockquote":
      return `<blockquote>${renderChildren(node, "\n", signal)}</blockquote>`;
    case "list": {
      const tag = node.ordered === true ? "ol" : "ul";
      const start =
        tag === "ol" && typeof node.start === "number" && node.start !== 1
          ? ` start="${node.start}"`
          : "";
      return `<${tag}${start}>${renderChildren(node, "", signal)}</${tag}>`;
    }
    case "listItem":
      return `<li>${renderChildren(node, "", signal)}</li>`;
    case "emphasis":
      return `<em>${renderChildren(node, "", signal)}</em>`;
    case "strong":
      return `<strong>${renderChildren(node, "", signal)}</strong>`;
    case "delete":
      return `<del>${renderChildren(node, "", signal)}</del>`;
    case "text":
      return escapeHtml(typeof node.value === "string" ? node.value : "");
    case "inlineCode":
      return `<code>${escapeHtml(typeof node.value === "string" ? node.value : "")}</code>`;
    case "code":
      return `<pre><code>${escapeHtml(typeof node.value === "string" ? node.value : "")}</code></pre>`;
    case "break":
      return "<br>";
    case "thematicBreak":
      return "<hr>";
    default:
      return renderChildren(node, "", signal);
  }
}

function renderPlainNode(node: MarkdownNode, signal?: AbortSignal): string {
  checkTextAbort(signal);
  const children = node.children ?? [];
  const output: string[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child) output[output.length] = renderPlainNode(child, signal);
  }
  const inline = intrinsicReflectApply(intrinsicArrayJoin, output, [""]) as string;
  const blocks = intrinsicReflectApply(intrinsicArrayJoin, output, ["\n\n"]) as string;
  switch (node.type) {
    case "root":
    case "blockquote":
      return blocks;
    case "list":
      return intrinsicReflectApply(intrinsicArrayJoin, output, ["\n"]) as string;
    case "listItem":
      return `- ${blocks}`;
    case "break":
      return "\n";
    case "thematicBreak":
      return "---";
    case "text":
    case "inlineCode":
    case "code":
      return typeof node.value === "string" ? node.value : "";
    default:
      return inline;
  }
}

async function markdownFromPlainText(value: string, signal?: AbortSignal): Promise<string> {
  const tree: MarkdownNode = {
    type: "root",
    children:
      value.length === 0 ? [] : [{ type: "paragraph", children: [{ type: "text", value }] }],
  };
  assertSyntaxTreeBudget(tree, signal);
  return stringifyMarkdown(tree, signal);
}

async function turndownHtml(value: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    headingStyle: "atx",
    hr: "---",
    strongDelimiter: "**",
  });
  const intrinsicTurndown = TurndownService.prototype.turndown;
  return intrinsicReflectApply(intrinsicTurndown, service, [value]) as string;
}

async function convertInternal(
  bytes: unknown,
  input: unknown,
  output: unknown,
  encoding: unknown,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!isTextFormat(input) || !isTextFormat(output) || !isTextEncoding(encoding)) {
    raiseTextFailure("LOCAL_TEXT_FORMAT_INVALID");
  }
  checkTextAbort(signal);
  const sourceBytes = copyInputBytes(bytes);
  await textCheckpoint(signal);
  const source = normalizeTextSource(strictDecode(sourceBytes, encoding), signal);
  await textCheckpoint(signal);

  let result: string;
  if (input === "txt") {
    if (output === "txt") result = source;
    else if (output === "md") result = await markdownFromPlainText(source, signal);
    else result = `<pre>${escapeHtml(source)}</pre>`;
  } else if (input === "md") {
    const markdown = await canonicalMarkdown(source, signal);
    if (output === "md") result = markdown.markdown;
    else if (output === "html") result = renderHtmlNode(markdown.tree, signal);
    else result = renderPlainNode(markdown.tree, signal);
  } else {
    const html = await sanitizeHtmlInternal(source, signal);
    if (output === "html") result = html;
    else {
      const markdown = await canonicalMarkdown(await turndownHtml(html), signal);
      result = output === "md" ? markdown.markdown : renderPlainNode(markdown.tree, signal);
    }
  }
  await textCheckpoint(signal);
  return encodeTextOutput(result);
}

export async function convertSemanticText(
  bytes: Uint8Array,
  input: TextFormat,
  output: TextFormat,
  encoding: TextEncoding,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return runTextBoundary(() => convertInternal(bytes, input, output, encoding, signal));
}

function outputMediaType(format: TextFormat): string {
  switch (format) {
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "html":
      return "text/html";
  }
}

export async function dispatchSemanticTextConversion(
  request: LocalConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (request.operation !== "text.semantic") {
    throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  const input = request.inputFormat;
  const output = request.outputFormat;
  if (!isTextFormat(input) || !isTextFormat(output)) {
    throw new IntrinsicError("LOCAL_TEXT_FORMAT_INVALID");
  }
  const bytes = await convertSemanticText(
    request.bytes,
    input,
    output,
    request.options.encoding ?? "utf-8",
    signal,
  );
  const result = intrinsicObjectCreate(null) as { bytes: Uint8Array; mediaType: string };
  result.bytes = bytes;
  result.mediaType = outputMediaType(output);
  return intrinsicFreeze(result);
}
