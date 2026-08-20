import type { TemplateFieldManifestEntryV1 } from "@opentrad/document-core";

const SAFE_SEGMENT = /^(?:[A-Za-z][A-Za-z0-9_-]*|0|[1-9]\d*)$/u;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/u;
const DANGEROUS_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_PATH_DEPTH = 12;
const MAX_ARRAY_INDEX = 499;
const MAX_TOTAL_VALUES = 10_000;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const INTEGER = /^-?(?:0|[1-9]\d*)$/u;

type SafeRecord = Record<string, unknown>;

interface CloneState {
  count: number;
  readonly stack: WeakSet<object>;
}

function dataDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor : undefined;
}

function invalidData(): never {
  throw new Error("字段数据不安全");
}

function incrementBudget(state: CloneState): void {
  state.count += 1;
  if (state.count > MAX_TOTAL_VALUES) invalidData();
}

function cloneSafeValue(value: unknown, state: CloneState, depth = 0): unknown {
  incrementBudget(state);
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidData();
    return value;
  }
  if (typeof value !== "object" || depth > MAX_PATH_DEPTH) invalidData();

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return invalidData();
  }

  if (state.stack.has(value)) invalidData();
  state.stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > MAX_ARRAY_INDEX + 1) invalidData();
      if (keys.some((key) => typeof key !== "string") || keys.length !== value.length + 1) {
        invalidData();
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = dataDescriptor(value, String(index));
        if (!descriptor) invalidData();
        output.push(cloneSafeValue(descriptor.value, state, depth + 1));
      }
      return output;
    }

    if (prototype !== Object.prototype && prototype !== null) invalidData();
    const output = Object.create(null) as SafeRecord;
    for (const key of keys) {
      if (typeof key !== "string" || DANGEROUS_SEGMENTS.has(key)) invalidData();
      const descriptor = dataDescriptor(value, key);
      if (!descriptor) invalidData();
      output[key] = cloneSafeValue(descriptor.value, state, depth + 1);
    }
    return output;
  } finally {
    state.stack.delete(value);
  }
}

function assertNotProxy(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  try {
    structuredClone(value);
  } catch {
    invalidData();
  }
}

function safeSnapshot<T>(value: T): T {
  const output = cloneSafeValue(value, { count: 0, stack: new WeakSet<object>() });
  assertNotProxy(value);
  return output as T;
}

function parsePath(path: string): readonly string[] {
  const segments = path.split(".");
  if (
    path.length === 0 ||
    segments.length > MAX_PATH_DEPTH ||
    segments.some(
      (segment) =>
        !SAFE_SEGMENT.test(segment) ||
        DANGEROUS_SEGMENTS.has(segment) ||
        (ARRAY_INDEX.test(segment) && Number(segment) > MAX_ARRAY_INDEX),
    )
  ) {
    throw new Error("字段路径不安全");
  }
  return segments;
}

function ownValue(value: object, segment: string): unknown {
  const descriptor = dataDescriptor(value, segment);
  return descriptor?.value;
}

function ensureContainer(value: unknown, nextSegment: string): SafeRecord | unknown[] {
  if (value !== null && typeof value === "object") return value as SafeRecord | unknown[];
  return ARRAY_INDEX.test(nextSegment) ? [] : (Object.create(null) as SafeRecord);
}

function setPathValue(target: unknown, segments: readonly string[], value: unknown): void {
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const nextSegment = segments[index + 1] as string;
    if (current === null || typeof current !== "object") invalidData();
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(segment)) throw new Error("字段路径不安全");
      const numericIndex = Number(segment);
      if (numericIndex > current.length) throw new Error("字段路径不安全");
      const child = ensureContainer(current[numericIndex], nextSegment);
      if (numericIndex === current.length) current.push(child);
      else current[numericIndex] = child;
      current = child;
      continue;
    }
    const record = current as SafeRecord;
    const child = ensureContainer(ownValue(record, segment), nextSegment);
    record[segment] = child;
    current = child;
  }

  const leaf = segments.at(-1) as string;
  if (current === null || typeof current !== "object") invalidData();
  if (Array.isArray(current)) {
    if (!ARRAY_INDEX.test(leaf)) throw new Error("字段路径不安全");
    const numericIndex = Number(leaf);
    if (numericIndex > current.length) throw new Error("字段路径不安全");
    if (numericIndex === current.length) current.push(value);
    else current[numericIndex] = value;
    return;
  }
  (current as SafeRecord)[leaf] = value;
}

export function getDraftField(source: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current = safeSnapshot(source) as unknown;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current) && !ARRAY_INDEX.test(segment)) {
      throw new Error("字段路径不安全");
    }
    current = ownValue(current, segment);
  }
  return current;
}

export function setDraftField<T>(source: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  const output = safeSnapshot(source);
  const safeValue = safeSnapshot(value);
  setPathValue(output, segments, safeValue);
  return output;
}

export function deleteDraftField<T>(source: T, path: string): T {
  const segments = parsePath(path);
  const output = safeSnapshot(source);
  let current = output as unknown;
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== "object") return output;
    current = ownValue(current, segment);
  }
  if (current === null || typeof current !== "object") return output;
  const leaf = segments.at(-1) as string;
  if (Array.isArray(current)) {
    if (!ARRAY_INDEX.test(leaf) || Number(leaf) >= current.length) return output;
    current.splice(Number(leaf), 1);
  } else {
    Reflect.deleteProperty(current, leaf);
  }
  return output;
}

function invalidRawValue(): never {
  throw new Error("字段值无效");
}

function stringRaw(raw: unknown): string {
  if (typeof raw !== "string") invalidRawValue();
  return raw;
}

function validDate(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function scaledInteger(rawValue: unknown, scale: number): number {
  const raw = stringRaw(rawValue);
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(raw);
  if (!match || (match[3]?.length ?? 0) > scale) invalidRawValue();
  const fraction = (match[3] ?? "").padEnd(scale, "0");
  const magnitude = BigInt(match[2] as string) * 10n ** BigInt(scale) + BigInt(fraction || "0");
  const signed = match[1] === "-" ? -magnitude : magnitude;
  const output = Number(signed);
  if (!Number.isSafeInteger(output)) invalidRawValue();
  return output;
}

function scaledUnsignedString(rawValue: unknown, scale: number): string {
  const raw = stringRaw(rawValue);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(raw);
  if (!match || (match[2]?.length ?? 0) > scale) invalidRawValue();
  const fraction = (match[2] ?? "").padEnd(scale, "0");
  return (BigInt(match[1] as string) * 10n ** BigInt(scale) + BigInt(fraction || "0")).toString();
}

function offsetDateTime(rawValue: unknown, currentValue: unknown): string {
  const raw = stringRaw(rawValue);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(raw);
  if (!match || !validDate(match[1] as string)) invalidRawValue();
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) invalidRawValue();
  const currentOffset =
    typeof currentValue === "string" ? /(Z|[+-]\d{2}:\d{2})$/u.exec(currentValue)?.[1] : undefined;
  return `${match[1]}T${match[2]}:${match[3]}:${String(second).padStart(2, "0")}${currentOffset ?? "Z"}`;
}

export function parseRawFieldValue(
  field: TemplateFieldManifestEntryV1,
  raw: unknown,
  currentValue?: unknown,
): unknown {
  switch (field.valueKind) {
    case "string":
      return stringRaw(raw);
    case "localized-text": {
      const output =
        currentValue === undefined
          ? (Object.create(null) as SafeRecord)
          : (safeSnapshot(currentValue) as SafeRecord);
      output.zhCN = stringRaw(raw);
      return output;
    }
    case "date": {
      const value = stringRaw(raw);
      if (!validDate(value)) invalidRawValue();
      return value;
    }
    case "offset-datetime":
      return offsetDateTime(raw, currentValue);
    case "integer": {
      const value = stringRaw(raw);
      if (!INTEGER.test(value)) invalidRawValue();
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) invalidRawValue();
      return parsed;
    }
    case "decimal-string": {
      const value = stringRaw(raw);
      if (!DECIMAL.test(value)) invalidRawValue();
      return value;
    }
    case "money-minor":
      return scaledUnsignedString(raw, 2);
    case "basis-points":
      return scaledInteger(raw, 2);
    case "boolean":
      if (typeof raw !== "boolean") invalidRawValue();
      return raw;
    case "enum": {
      const value = stringRaw(raw);
      if (!field.options.some((option) => option.value === value)) invalidRawValue();
      return value;
    }
    case "string-list": {
      if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) invalidRawValue();
      return safeSnapshot(raw);
    }
    case "attachment-id":
      return stringRaw(raw);
    case "attachment-id-list":
      if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) invalidRawValue();
      return safeSnapshot(raw);
    case "object-list":
      if (!Array.isArray(raw)) invalidRawValue();
      return safeSnapshot(raw);
    default:
      return invalidRawValue();
  }
}

export function updateDraftFromRaw<T>(
  source: T,
  field: TemplateFieldManifestEntryV1,
  raw: unknown,
): T {
  if (field.control === "select" && !field.required && raw === "") {
    return deleteDraftField(source, field.path);
  }
  const currentValue = getDraftField(source, field.path);
  return setDraftField(source, field.path, parseRawFieldValue(field, raw, currentValue));
}
