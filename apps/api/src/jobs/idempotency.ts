import { createHmac, timingSafeEqual } from "node:crypto";
import { CreateJobRequestSchema } from "@opentrad/contracts";

const KEY_PATTERN = /^[\x21-\x7e]{16,128}$/u;
const OWNER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const DOMAIN = "opentrad/job-idempotency-key/v1";
const intrinsicJsonStringify = JSON.stringify;

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("INVALID_IDEMPOTENCY_KEY");
  }
}

function requirePlainString(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new InvalidIdempotencyKeyError();
  return value;
}

export function idempotencyKeyHmac(secret: string, ownerId: string, key: string): string {
  const safeSecret = requirePlainString(secret, /^.{32,4096}$/u);
  const safeOwner = requirePlainString(ownerId, OWNER_PATTERN);
  const safeKey = requirePlainString(key, KEY_PATTERN);
  return createHmac("sha256", safeSecret)
    .update(DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(safeOwner, "utf8")
    .update("\0", "utf8")
    .update(safeKey, "utf8")
    .digest("base64url");
}

export function canonicalRequestShape(input: unknown): string {
  const request = CreateJobRequestSchema.parse(input);
  return intrinsicJsonStringify({
    operation: request.operation,
    inputFormat: request.inputFormat,
    outputFormat: request.outputFormat,
    inputBytes: request.inputBytes,
    options: request.options,
  });
}

export function requestShapesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    const dummy = Buffer.alloc(leftBytes.length);
    timingSafeEqual(leftBytes, dummy);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
