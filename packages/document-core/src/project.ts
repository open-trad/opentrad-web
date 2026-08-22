import { calculateQuoteTotals } from "./money.js";
import {
  type OpenTradProjectEnvelope,
  PROJECT_FORMAT_VERSION,
  ProjectEnvelopeSchema,
  parseDocumentDraft,
  parseProjectEnvelopeInput,
} from "./schemas.js";

export const MAX_PROJECT_BYTES = 1_048_576;
export const MAX_PROJECT_DEPTH = 12;
export const MAX_PROJECT_STRING_LENGTH = 16_384;

const textEncoder = new TextEncoder();

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
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

  const parsed = parseProjectEnvelopeInput(unknownProject);
  return ProjectEnvelopeSchema.parse({
    formatVersion: parsed.formatVersion,
    templateId: parsed.templateId,
    templateVersion: parsed.templateVersion,
    draft: parsed.draft,
    calculation: calculateQuoteTotals(parsed.draft),
  });
}
