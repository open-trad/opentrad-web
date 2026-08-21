import { isProxy } from "node:util/types";
import { v2 } from "@opentrad/document-core";
import {
  type BidArchiveRequest,
  BidPolicyError,
  copyExactUint8Array,
  hardenBidValue,
  parseBidArchiveRequest,
} from "./bidArchive.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const MAX_DRAFT_BYTES = 1024 * 1024;
const intrinsicReflectApply = Reflect.apply;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

function invalid(): never {
  throw new BidPolicyError();
}

function exactRuntimeInput(input: unknown): { readonly now: () => number } {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 1
  ) {
    return invalid();
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(input, "now");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") invalid();
  return { now: descriptor.value as () => number };
}

export interface BidCompileRuntime {
  readonly now: () => number;
}

const compileRuntimeBrand = new WeakSet<object>();
const compileSnapshotBrand = new WeakSet<object>();

export function createBidCompileRuntime(input: unknown): BidCompileRuntime {
  try {
    const parsed = exactRuntimeInput(input);
    const runtime = Object.create(null) as BidCompileRuntime;
    Object.defineProperty(runtime, "now", { enumerable: true, value: parsed.now });
    Object.freeze(runtime);
    intrinsicReflectApply(intrinsicWeakSetAdd, compileRuntimeBrand, [runtime]);
    return runtime;
  } catch {
    return invalid();
  }
}

function trustedAsOf(runtime: BidCompileRuntime): string {
  if (!intrinsicReflectApply(intrinsicWeakSetHas, compileRuntimeBrand, [runtime])) invalid();
  let value: unknown;
  try {
    value = Reflect.apply(runtime.now, undefined, []);
  } catch {
    return invalid();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  try {
    return new Date(value).toISOString();
  } catch {
    return invalid();
  }
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) invalid();
  return `{${(keys as string[])
    .filter((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) invalid();
      return descriptor.value !== undefined;
    })
    .sort()
    .map((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return invalid();
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`;
    })
    .join(",")}}`;
}

function containsLocalBlobKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (intrinsicReflectApply(intrinsicWeakSetHas, seen, [value])) invalid();
  intrinsicReflectApply(intrinsicWeakSetAdd, seen, [value]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid();
    if (key === "localBlobKey") return true;
    if (containsLocalBlobKey(descriptor.value, seen)) return true;
  }
  return false;
}

function safeFindingArray(input: unknown): readonly v2.RiskFindingV2[] {
  if (
    !Array.isArray(input) ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > 500 ||
    Reflect.ownKeys(input).length !== input.length + 1
  ) {
    return invalid();
  }
  const output: v2.RiskFindingV2[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) invalid();
    output.push(v2.RiskFindingV2Schema.parse(descriptor.value));
  }
  return Object.freeze(output);
}

function publicAttachmentManifest(
  input: readonly v2.AttachmentRefV1[],
): readonly v2.AttachmentRefV1[] {
  const localOnly = (sourceRef: string): boolean => {
    const value = sourceRef.trim();
    return (
      /^[a-z][a-z0-9+.-]*:/iu.test(value) ||
      /^(?:\/|\\|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/iu.test(value) ||
      value.includes("\\")
    );
  };
  return input
    .filter((attachment) => attachment.includedInSubmission)
    .map((attachment) => ({
      id: attachment.id,
      category: attachment.category,
      displayName: attachment.displayName,
      mediaType: attachment.mediaType,
      ...(attachment.pageCount === undefined ? {} : { pageCount: attachment.pageCount }),
      required: attachment.required,
      ...(attachment.sourceRef === undefined || localOnly(attachment.sourceRef)
        ? {}
        : { sourceRef: attachment.sourceRef }),
      status: attachment.status,
      includedInSubmission: true,
    }));
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function hasAttachmentPage(model: v2.DocumentModelV2): boolean {
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.type === "attachmentPage") return true;
    }
  }
  return false;
}

export interface BidCompileSnapshot {
  readonly asOf: string;
  readonly findings: readonly v2.RiskFindingV2[];
  readonly language: v2.DocumentLanguageV2;
  readonly layoutStyleId: v2.LayoutStyleId;
  readonly model: v2.DocumentModelV2;
  readonly profile: "bid";
  readonly schemaVersion: "bid-compile-snapshot-v1";
}

function compileProject(
  input: unknown,
  requestInput: unknown,
  runtime: BidCompileRuntime,
): BidCompileSnapshot {
  const asOf = trustedAsOf(runtime);
  const request: BidArchiveRequest = parseBidArchiveRequest(requestInput);
  const draftBytes = copyExactUint8Array(input, MAX_DRAFT_BYTES);
  let serialized: string;
  let parsedProject: v2.OpenTradProject;
  try {
    serialized = decoder.decode(draftBytes);
    parsedProject = v2.parseOpenTradProject(serialized);
  } catch {
    return invalid();
  }
  if (parsedProject.formatVersion !== "2.0.0") invalid();
  let envelope: v2.ProjectEnvelopeV2;
  try {
    envelope = v2.ProjectEnvelopeV2Schema.parse(parsedProject);
    const canonical = encoder.encode(v2.serializeProjectV2(envelope));
    if (!byteEqual(canonical, draftBytes)) invalid();
  } catch {
    return invalid();
  }
  if (
    envelope.template.id !== request.templateId ||
    envelope.template.version !== request.templateVersion ||
    envelope.template.basisDate !== "2026-08-19" ||
    containsLocalBlobKey(envelope)
  ) {
    invalid();
  }

  let registration: ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get>;
  try {
    registration = v2.V2_TEMPLATE_REGISTRY.get(request.templateId, request.templateVersion);
  } catch {
    return invalid();
  }
  const definition = registration.definition;
  if (
    definition.id !== envelope.template.id ||
    definition.version !== envelope.template.version ||
    definition.basisDate !== envelope.template.basisDate ||
    definition.category !== "bid" ||
    !definition.languages.includes(envelope.presentation.languageView) ||
    !definition.allowedLayouts.includes(envelope.presentation.layoutStyleId)
  ) {
    invalid();
  }

  let parsedDraft: unknown;
  try {
    parsedDraft = registration.parseDraft(envelope.draft);
    envelope = v2.ProjectEnvelopeV2Schema.parse({ ...envelope, draft: parsedDraft });
  } catch {
    return invalid();
  }
  if (containsLocalBlobKey(envelope)) invalid();
  const draftAttachments = (parsedDraft as { readonly attachments?: unknown }).attachments;
  if (!sameJson(envelope.attachmentManifest, draftAttachments)) invalid();

  const context = Object.freeze({ asOf });
  let findings: readonly v2.RiskFindingV2[];
  let model: v2.DocumentModelV2;
  try {
    findings = safeFindingArray(registration.preflight(parsedDraft as never, context));
    if (findings.some((finding) => finding.impact === "blockSubmission")) invalid();
    model = v2.DocumentModelV2Schema.parse(registration.compile(parsedDraft as never, context));
  } catch {
    return invalid();
  }
  if (
    model.documentKind !== "bid" ||
    model.documentId !== envelope.draft.id ||
    model.template.id !== envelope.template.id ||
    model.template.version !== envelope.template.version ||
    model.template.basisDate !== envelope.template.basisDate ||
    model.language !== envelope.presentation.languageView ||
    containsLocalBlobKey(model) ||
    hasAttachmentPage(model) ||
    !sameJson(model.attachmentManifest, publicAttachmentManifest(envelope.attachmentManifest))
  ) {
    invalid();
  }

  const result = hardenBidValue({
    schemaVersion: "bid-compile-snapshot-v1" as const,
    profile: "bid" as const,
    asOf,
    layoutStyleId: envelope.presentation.layoutStyleId,
    language: envelope.presentation.languageView,
    findings,
    model,
  });
  intrinsicReflectApply(intrinsicWeakSetAdd, compileSnapshotBrand, [result]);
  return result;
}

/** Internal brand assertion. Deliberately omitted from the package barrel. */
export function requireBidCompileSnapshot(input: unknown): BidCompileSnapshot {
  if (
    input === null ||
    typeof input !== "object" ||
    isProxy(input) ||
    !intrinsicReflectApply(intrinsicWeakSetHas, compileSnapshotBrand, [input])
  ) {
    return invalid();
  }
  return input as BidCompileSnapshot;
}

export function compileCanonicalBidProject(
  input: unknown,
  request: unknown,
  runtime: BidCompileRuntime,
): BidCompileSnapshot {
  try {
    return compileProject(input, request, runtime);
  } catch {
    throw new BidPolicyError();
  }
}
