import { isProxy } from "node:util/types";
import { type CreateJobRequest, CreateJobRequestSchema } from "@opentrad/contracts";
import { z } from "zod";

const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayEvery = Array.prototype.every;
const intrinsicArrayIncludes = Array.prototype.includes;
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicReflectApply = Reflect.apply;

const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "jobId",
  "operation",
  "inputFormat",
  "outputFormat",
  "options",
  "inputBytes",
] as const);
const MAX_SNAPSHOT_DEPTH = 4;
const MAX_SNAPSHOT_KEYS = 32;

export type WorkerManifest = Readonly<
  {
    schemaVersion: "server-v1";
    jobId: string;
  } & CreateJobRequest
>;

function snapshot(value: unknown, depth = 0): unknown {
  if (depth > MAX_SNAPSHOT_DEPTH) throw new Error("depth");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object" || intrinsicArrayIsArray(value)) throw new Error("type");
  if (isProxy(value)) throw new Error("proxy");
  if (intrinsicGetPrototypeOf(value) !== intrinsicObjectPrototype) throw new Error("prototype");

  const keys = intrinsicReflectOwnKeys(value);
  if (keys.length > MAX_SNAPSHOT_KEYS) throw new Error("keys");
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") throw new Error("symbol");
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error("key");
    }
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("accessor");
    intrinsicDefineProperty(output, key, {
      enumerable: true,
      value: snapshot(descriptor.value, depth + 1),
    });
  }
  return output;
}

export type Hardened<T> = T extends readonly (infer Item)[]
  ? readonly Hardened<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Hardened<T[Key]> }
    : T;

export function hardenWorkerValue<T>(value: T): Hardened<T> {
  if (value === null || typeof value !== "object") return value as Hardened<T>;
  if (intrinsicArrayIsArray(value)) {
    const output: unknown[] = [];
    for (const entry of value) output.push(hardenWorkerValue(entry));
    return intrinsicFreeze(output) as Hardened<T>;
  }
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  for (const key of intrinsicReflectOwnKeys(value)) {
    if (typeof key !== "string") throw new Error("Invalid worker value");
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("Invalid worker value");
    intrinsicDefineProperty(output, key, {
      enumerable: true,
      value: hardenWorkerValue(descriptor.value),
    });
  }
  return intrinsicFreeze(output) as Hardened<T>;
}

function hasExactManifestKeys(value: Record<string, unknown>): boolean {
  const keys = intrinsicReflectOwnKeys(value);
  if (keys.length !== MANIFEST_KEYS.length) return false;
  return intrinsicReflectApply(intrinsicArrayEvery, MANIFEST_KEYS, [
    (key: string) => intrinsicReflectApply(intrinsicArrayIncludes, keys, [key]) as boolean,
  ]) as boolean;
}

export function parseWorkerManifest(input: unknown): WorkerManifest {
  try {
    const value = snapshot(input);
    if (value === null || typeof value !== "object" || intrinsicArrayIsArray(value)) {
      throw new Error("shape");
    }
    const record = value as Record<string, unknown>;
    if (!hasExactManifestKeys(record) || record.schemaVersion !== "server-v1") {
      throw new Error("shape");
    }
    const jobId = z.string().uuid().parse(record.jobId);
    const request = CreateJobRequestSchema.parse({
      operation: record.operation,
      inputFormat: record.inputFormat,
      outputFormat: record.outputFormat,
      options: record.options,
      inputBytes: record.inputBytes,
    });
    return hardenWorkerValue({ schemaVersion: "server-v1" as const, jobId, ...request });
  } catch {
    throw new Error("Invalid worker manifest");
  }
}
