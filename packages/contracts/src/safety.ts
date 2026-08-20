import { z } from "zod";

const MAX_DEPTH = 8;
const MAX_ARRAY_ENTRIES = 128;
const MAX_OBJECT_KEYS = 128;
const MAX_KEY_LENGTH = 128;
const MAX_STRING_LENGTH = 2_048;
const MAX_TOTAL_STRINGS = 65_536;
const MAX_TOTAL_VALUES = 2_048;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/u;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicHasOwn = Object.hasOwn;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicNumber = Number;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicString = String;
const IntrinsicWeakSet = WeakSet;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetDelete = WeakSet.prototype.delete;
const intrinsicWeakSetHas = WeakSet.prototype.has;

interface SnapshotBudget {
  readonly active: WeakSet<object>;
  totalStrings: number;
  totalValues: number;
}

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [Index in keyof T]: DeepReadonly<T[Index]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function fail(message: string): never {
  throw new Error(message);
}

function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) fail("Accessors are not accepted");
  return descriptor.value;
}

function snapshotString(value: string, budget: SnapshotBudget): string {
  if (value.length > MAX_STRING_LENGTH) fail("String budget exceeded");
  budget.totalStrings += value.length;
  if (budget.totalStrings > MAX_TOTAL_STRINGS) fail("Aggregate string budget exceeded");
  return value;
}

function snapshotArray(
  value: unknown[],
  depth: number,
  budget: SnapshotBudget,
): readonly unknown[] {
  if (intrinsicGetPrototypeOf(value) !== intrinsicArrayPrototype) fail("Expected a plain array");
  const length = ownData(value, "length");
  if (
    !intrinsicNumberIsSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > MAX_ARRAY_ENTRIES
  ) {
    fail("Array budget exceeded");
  }
  const keys = intrinsicReflectOwnKeys(value);
  if (keys.length !== (length as number) + 1) fail("Array properties are invalid");
  const output: unknown[] = [];
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !intrinsicReflectApply(intrinsicRegExpTest, ARRAY_INDEX, [key])
    ) {
      fail("Array key is invalid");
    }
    const index = intrinsicNumber(key);
    if (index >= (length as number) || intrinsicString(index) !== key) fail("Array key is invalid");
  }
  for (let index = 0; index < (length as number); index += 1) {
    const key = intrinsicString(index);
    if (!intrinsicHasOwn(value, key)) fail("Sparse arrays are not accepted");
    intrinsicDefineProperty(output, index, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(ownData(value, key), depth + 1, budget),
      writable: true,
    });
  }
  return output;
}

function snapshotObject(
  value: object,
  depth: number,
  budget: SnapshotBudget,
): Readonly<Record<string, unknown>> {
  const prototype = intrinsicGetPrototypeOf(value);
  if (prototype !== intrinsicObjectPrototype && prototype !== null) fail("Expected a plain object");
  const keys = intrinsicReflectOwnKeys(value);
  if (keys.length > MAX_OBJECT_KEYS) fail("Object key budget exceeded");
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (typeof key !== "string") fail("Symbols are not accepted");
    if (key.length > MAX_KEY_LENGTH) fail("Object key budget exceeded");
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      fail("Dangerous object key");
    }
    snapshotString(key, budget);
    intrinsicDefineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(ownData(value, key), depth + 1, budget),
      writable: true,
    });
  }
  return output;
}

function snapshotValue(value: unknown, depth: number, budget: SnapshotBudget): unknown {
  budget.totalValues += 1;
  if (budget.totalValues > MAX_TOTAL_VALUES) fail("Aggregate value budget exceeded");
  if (depth > MAX_DEPTH) fail("Maximum input depth exceeded");
  if (typeof value === "string") return snapshotString(value, budget);
  if (typeof value === "number") {
    if (!intrinsicNumberIsFinite(value)) fail("Non-finite numbers are not accepted");
    return value;
  }
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value !== "object") fail("Unsupported input value");
  if (intrinsicReflectApply(intrinsicWeakSetHas, budget.active, [value])) {
    fail("Cyclic input is not accepted");
  }
  intrinsicReflectApply(intrinsicWeakSetAdd, budget.active, [value]);
  try {
    return intrinsicArrayIsArray(value)
      ? snapshotArray(value, depth, budget)
      : snapshotObject(value, depth, budget);
  } finally {
    intrinsicReflectApply(intrinsicWeakSetDelete, budget.active, [value]);
  }
}

function snapshotInput(input: unknown): unknown {
  return snapshotValue(input, 0, {
    active: new IntrinsicWeakSet<object>(),
    totalStrings: 0,
    totalValues: 0,
  });
}

export function harden<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object") return value as DeepReadonly<T>;
  if (intrinsicArrayIsArray(value)) {
    const length = ownData(value, "length");
    if (!intrinsicNumberIsSafeInteger(length) || (length as number) < 0) {
      fail("Array output is invalid");
    }
    const output: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      intrinsicDefineProperty(output, index, {
        configurable: true,
        enumerable: true,
        value: harden(ownData(value, intrinsicString(index))),
        writable: true,
      });
    }
    return intrinsicFreeze(output) as DeepReadonly<T>;
  }
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  const keys = intrinsicReflectOwnKeys(value);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (typeof key !== "string") fail("Symbol output is invalid");
    intrinsicDefineProperty(output, key, {
      enumerable: true,
      value: harden(ownData(value, key)),
    });
  }
  return intrinsicFreeze(output) as DeepReadonly<T>;
}

export function safeSchema<T>(schema: z.ZodType<T>) {
  return z
    .transform<unknown, unknown>((input, context) => {
      try {
        return snapshotInput(input);
      } catch {
        context.addIssue({ code: "custom", message: "Input validation failed safely" });
        return z.NEVER;
      }
    })
    .pipe(schema)
    .transform((value): DeepReadonly<T> => harden(value));
}
