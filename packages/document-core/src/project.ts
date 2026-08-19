import { calculateQuoteTotals } from "./money.js";
import {
  DocumentDraftSchema,
  type OpenTradProjectEnvelope,
  PROJECT_FORMAT_VERSION,
  ProjectEnvelopeSchema,
  parseDocumentDraft,
  STANDARD_GOODS_QUOTE_TEMPLATE_ID,
  STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
} from "./schemas.js";
import { z } from "./zod.js";

export const MAX_PROJECT_BYTES = 1_048_576;
export const MAX_PROJECT_DEPTH = 12;
export const MAX_PROJECT_STRING_LENGTH = 16_384;

const MAX_PROJECT_ARRAY_LENGTH = 100;
const MAX_PROJECT_OBJECT_KEYS = 200;
const MAX_PROJECT_KEY_LENGTH = 200;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const textEncoder = new TextEncoder();

const ProjectEnvelopeInputSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  draft: DocumentDraftSchema,
  calculation: z.unknown().optional(),
});

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function assertSafeProjectValue(value: unknown, depth = 0): void {
  if (depth > MAX_PROJECT_DEPTH) {
    throw new Error(`Project exceeds maximum object depth of ${MAX_PROJECT_DEPTH}`);
  }
  if (typeof value === "string") {
    if (value.length > MAX_PROJECT_STRING_LENGTH) {
      throw new Error(`Project string exceeds ${MAX_PROJECT_STRING_LENGTH} characters`);
    }
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PROJECT_ARRAY_LENGTH) {
      throw new Error(`Project array exceeds ${MAX_PROJECT_ARRAY_LENGTH} entries`);
    }
    for (const item of value) {
      assertSafeProjectValue(item, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Project contains an unsupported value");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Project contains a non-plain object");
  }
  let keyCount = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    keyCount += 1;
    if (keyCount > MAX_PROJECT_OBJECT_KEYS) {
      throw new Error(`Project object exceeds ${MAX_PROJECT_OBJECT_KEYS} keys`);
    }
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`Project contains dangerous key: ${key}`);
    }
    if (key.length > MAX_PROJECT_KEY_LENGTH) {
      throw new Error(`Project key exceeds ${MAX_PROJECT_KEY_LENGTH} characters`);
    }
    assertSafeProjectValue((value as Record<string, unknown>)[key], depth + 1);
  }
}

function assertProjectSize(serialized: string): void {
  if (serialized.length > MAX_PROJECT_BYTES) {
    throw new Error("Project exceeds the 1 MiB size limit");
  }
  if (byteLength(serialized) > MAX_PROJECT_BYTES) {
    throw new Error("Project exceeds the 1 MiB size limit");
  }
}

export function serializeProject(input: unknown): string {
  const draft = parseDocumentDraft(input);
  const envelope = ProjectEnvelopeSchema.parse({
    formatVersion: PROJECT_FORMAT_VERSION,
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    draft,
    calculation: calculateQuoteTotals(draft),
  });
  const serialized = JSON.stringify(envelope);
  assertProjectSize(serialized);
  return serialized;
}

export function parseProject(serialized: string): OpenTradProjectEnvelope {
  if (typeof serialized !== "string") {
    throw new TypeError("Project input must be a JSON string");
  }
  assertProjectSize(serialized);

  let unknownProject: unknown;
  try {
    unknownProject = JSON.parse(serialized);
  } catch {
    throw new Error("Project is not valid JSON");
  }

  assertSafeProjectValue(unknownProject);
  const parsed = ProjectEnvelopeInputSchema.parse(unknownProject);
  return ProjectEnvelopeSchema.parse({
    formatVersion: parsed.formatVersion,
    templateId: parsed.templateId,
    templateVersion: parsed.templateVersion,
    draft: parsed.draft,
    calculation: calculateQuoteTotals(parsed.draft),
  });
}
