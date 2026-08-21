import { CAPABILITIES } from "@opentrad/contracts";
import type { LocalAggregateOperation, LocalOperation } from "./protocol.js";

const IntrinsicError = Error;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicFreeze = Object.freeze;
const intrinsicObjectCreate = Object.create;

const limits = Object.create(null) as Record<LocalOperation, number>;
const operations = intrinsicFreeze([
  "text.semantic",
  "document.generate",
  "docx.extract",
  "pdf.inspect",
  "pdf.organize",
  "image.convert",
  "images.to.pdf",
] as const);

function capability(id: LocalOperation) {
  for (let index = 0; index < CAPABILITIES.length; index += 1) {
    const item = CAPABILITIES[index];
    if (item?.id === id && item.execution === "browser") return item;
  }
  throw new IntrinsicError("LOCAL_CAPABILITY_INVALID");
}

for (let index = 0; index < operations.length; index += 1) {
  const operation = operations[index];
  if (!operation) throw new IntrinsicError("LOCAL_CAPABILITY_INVALID");
  const maximum = capability(operation).limits.maxInputBytes;
  if (!intrinsicNumberIsSafeInteger(maximum) || maximum < 1) {
    throw new IntrinsicError("LOCAL_CAPABILITY_INVALID");
  }
  limits[operation] = maximum;
}

export const LOCAL_FILE_LIMITS: Readonly<Record<LocalOperation, number>> = intrinsicFreeze(limits);

export interface LocalAggregateLimit {
  readonly maxFiles: number;
  readonly maxInputBytes: number;
  readonly maxPages?: number;
  readonly maxTotalBytes: number;
}

const aggregateLimits = intrinsicObjectCreate(null) as Record<
  LocalAggregateOperation,
  LocalAggregateLimit
>;
for (const operation of ["pdf.organize", "images.to.pdf"] as const) {
  const source = capability(operation).limits;
  if (
    !intrinsicNumberIsSafeInteger(source.maxFiles) ||
    (source.maxFiles as number) < 1 ||
    !intrinsicNumberIsSafeInteger(source.maxTotalBytes) ||
    (source.maxTotalBytes as number) < source.maxInputBytes ||
    (operation === "pdf.organize" &&
      (!intrinsicNumberIsSafeInteger(source.maxPages) || (source.maxPages as number) < 1))
  ) {
    throw new IntrinsicError("LOCAL_CAPABILITY_INVALID");
  }
  const snapshot = intrinsicObjectCreate(null) as Record<string, number>;
  snapshot.maxFiles = source.maxFiles as number;
  snapshot.maxInputBytes = source.maxInputBytes;
  if (operation === "pdf.organize") snapshot.maxPages = source.maxPages as number;
  snapshot.maxTotalBytes = source.maxTotalBytes as number;
  aggregateLimits[operation] = intrinsicFreeze(snapshot) as unknown as LocalAggregateLimit;
}
export const LOCAL_AGGREGATE_LIMITS: Readonly<
  Record<LocalAggregateOperation, LocalAggregateLimit>
> = intrinsicFreeze(aggregateLimits);

export function assertLocalFileLimit(operation: LocalOperation, bytes: number): void {
  const maximum = LOCAL_FILE_LIMITS[operation];
  if (
    maximum === undefined ||
    !intrinsicNumberIsSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > maximum
  ) {
    throw new IntrinsicError("LOCAL_FILE_TOO_LARGE");
  }
}
