import { z } from "./zod.js";

const MAX_DEPTH = 12;
const MAX_OBJECT_KEYS = 200;
const MAX_KEY_LENGTH = 200;
const MAX_TABLE_CELL_KEYS = 20;
const MAX_STRING_LENGTH = 16_384;
const MAX_TOTAL_CHARACTERS = 524_288;
const MAX_TOTAL_UTF8_BYTES = 1_048_576;
const MAX_TOTAL_VALUES = 10_000;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;
const textEncoder = new TextEncoder();

type PathSegment = string | number;

interface SnapshotState {
  activeObjects: WeakSet<object>;
  policy: SnapshotPolicy;
  totalCharacters: number;
  totalUtf8Bytes: number;
  totalValues: number;
}

interface SnapshotPolicy {
  arrayLimits?: Readonly<Record<string, number>>;
}

const boundaryErrors = new WeakSet<object>();

class InputBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    boundaryErrors.add(this);
  }
}

function pathLabel(path: readonly PathSegment[]): string {
  return path.length === 0 ? "input" : path.join(".");
}

function arrayLimit(
  path: readonly PathSegment[],
  policy: SnapshotPolicy,
  parentTag?: string,
): number {
  const field = path.at(-1);
  if (
    typeof field === "string" &&
    policy.arrayLimits !== undefined &&
    Object.hasOwn(policy.arrayLimits, field)
  ) {
    return policy.arrayLimits[field] as number;
  }
  if (field === "supportedCurrencies") {
    return 3;
  }
  if (field === "parties") {
    return 2;
  }
  if (field === "nodes") {
    return 30;
  }
  if (field === "columns" || field === "details" || field === "path") {
    return 20;
  }
  if (field === "paragraphs") {
    return 10;
  }
  if (field === "entries") {
    return parentTag === "metadata" ? 20 : 10;
  }
  if (field === "lineItems" || field === "lines" || field === "rows") {
    return 100;
  }
  return 100;
}

function objectKeyLimit(path: readonly PathSegment[]): number {
  return path.at(-1) === "cells" ? MAX_TABLE_CELL_KEYS : MAX_OBJECT_KEYS;
}

function addStringBudget(value: string, state: SnapshotState, path: readonly PathSegment[]): void {
  if (value.length > MAX_STRING_LENGTH) {
    throw new InputBoundaryError(`${pathLabel(path)} exceeds the per-string limit`);
  }
  state.totalCharacters += value.length;
  if (state.totalCharacters > MAX_TOTAL_CHARACTERS) {
    throw new InputBoundaryError("Input exceeds the aggregate character budget");
  }
  state.totalUtf8Bytes += textEncoder.encode(value).byteLength;
  if (state.totalUtf8Bytes > MAX_TOTAL_UTF8_BYTES) {
    throw new InputBoundaryError("Input exceeds the aggregate UTF-8 byte budget");
  }
}

function dataDescriptor(value: object, key: PropertyKey): PropertyDescriptor {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    throw new InputBoundaryError("Input changed during boundary inspection");
  }
  if (!("value" in descriptor)) {
    throw new InputBoundaryError("Accessors are not accepted in document input");
  }
  return descriptor;
}

function snapshotArray(
  value: unknown[],
  state: SnapshotState,
  path: readonly PathSegment[],
  parentTag?: string,
): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InputBoundaryError(`${pathLabel(path)} must be a plain array`);
  }

  const lengthDescriptor = dataDescriptor(value, "length");
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new InputBoundaryError(`${pathLabel(path)} has an invalid array length`);
  }
  const limit = arrayLimit(path, state.policy, parentTag);
  if (length > limit) {
    throw new InputBoundaryError(`${pathLabel(path)} exceeds ${limit} entries`);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > length + 1) {
    throw new InputBoundaryError(`${pathLabel(path)} contains extra array properties`);
  }
  const indexKeys = new Set<string>();
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      throw new InputBoundaryError("Symbols are not accepted in document input");
    }
    if (key === "length") {
      continue;
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new InputBoundaryError("Input contains an overlong array key");
    }
    addStringBudget(key, state, [...path, key]);
    if (!ARRAY_INDEX_PATTERN.test(key)) {
      throw new InputBoundaryError(`${pathLabel(path)} contains a non-index array key`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new InputBoundaryError(`${pathLabel(path)} contains an invalid array index`);
    }
    indexKeys.add(key);
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!indexKeys.has(key)) {
      throw new InputBoundaryError(`${pathLabel(path)} must not contain sparse entries`);
    }
    const descriptor = dataDescriptor(value, key);
    Object.defineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(descriptor.value, state, [...path, index]),
      writable: true,
    });
  }
  return snapshot;
}

function snapshotObject(
  value: object,
  state: SnapshotState,
  path: readonly PathSegment[],
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InputBoundaryError(`${pathLabel(path)} must be a plain object`);
  }

  const ownKeys = Reflect.ownKeys(value);
  const limit = objectKeyLimit(path);
  if (ownKeys.length > limit) {
    throw new InputBoundaryError(`${pathLabel(path)} exceeds ${limit} keys`);
  }

  const properties = new Map<string, unknown>();
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      throw new InputBoundaryError("Symbols are not accepted in document input");
    }
    if (DANGEROUS_KEYS.has(key)) {
      throw new InputBoundaryError(`Input contains dangerous key: ${key}`);
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new InputBoundaryError("Input contains an overlong object key");
    }
    addStringBudget(key, state, [...path, key]);
    properties.set(key, dataDescriptor(value, key).value);
  }

  const tag = typeof properties.get("type") === "string" ? properties.get("type") : undefined;
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, propertyValue] of properties) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(propertyValue, state, [...path, key], tag as string | undefined),
      writable: true,
    });
  }
  return snapshot;
}

function snapshotValue(
  value: unknown,
  state: SnapshotState,
  path: readonly PathSegment[],
  parentTag?: string,
): unknown {
  state.totalValues += 1;
  if (state.totalValues > MAX_TOTAL_VALUES) {
    throw new InputBoundaryError("Input exceeds the aggregate value budget");
  }

  if (typeof value === "string") {
    addStringBudget(value, state, path);
    return value;
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value !== "object") {
    throw new InputBoundaryError(`${pathLabel(path)} contains an unsupported value`);
  }
  if (path.length > MAX_DEPTH) {
    throw new InputBoundaryError(`Input exceeds maximum object depth of ${MAX_DEPTH}`);
  }
  if (state.activeObjects.has(value)) {
    throw new InputBoundaryError("Input must not contain cyclic references");
  }

  state.activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      return snapshotArray(value, state, path, parentTag);
    }
    return snapshotObject(value, state, path);
  } finally {
    state.activeObjects.delete(value);
  }
}

export function snapshotCompositeInput(input: unknown, policy: SnapshotPolicy = {}): unknown {
  return snapshotValue(
    input,
    {
      activeObjects: new WeakSet(),
      policy,
      totalCharacters: 0,
      totalUtf8Bytes: 0,
      totalValues: 0,
    },
    [],
  );
}

export function boundedCompositeSchema<T extends z.ZodType>(
  schema: T,
  policy: SnapshotPolicy = {},
) {
  return z.transform<unknown, z.output<T>>((input, context) => {
    let snapshot: unknown;
    try {
      snapshot = snapshotCompositeInput(input, policy);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: boundaryErrors.has(error as object)
          ? (error as InputBoundaryError).message
          : "Input boundary inspection failed",
      });
      return z.NEVER;
    }

    const result = schema.safeParse(snapshot);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue });
      }
      return z.NEVER;
    }
    return result.data;
  });
}
