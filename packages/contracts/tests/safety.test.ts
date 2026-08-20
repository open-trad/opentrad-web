import { describe, expect, it } from "vitest";
import { z } from "zod";
import { safeSchema } from "../src/safety.js";

const OpenRecordSchema = safeSchema(z.record(z.string(), z.unknown()));
const ArraySchema = safeSchema(z.array(z.unknown()));

function nested(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

describe("safe schema hostile-input boundary", () => {
  it("rejects symbols, accessors and dangerous keys without invoking code", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const symbol = Object.create(null) as Record<PropertyKey, unknown>;
    symbol[Symbol("private")] = true;
    const dangerous = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(dangerous, "__proto__", { enumerable: true, value: true });

    for (const hostile of [accessor, symbol, dangerous]) {
      expect(() => OpenRecordSchema.parse(hostile)).toThrow();
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects cycles, sparse arrays and attached array properties", () => {
    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    const sparse = new Array(1);
    const attached = [1] as unknown[] & { private?: boolean };
    attached.private = true;

    expect(() => OpenRecordSchema.parse(cyclic)).toThrow();
    expect(() => ArraySchema.parse(sparse)).toThrow();
    expect(() => ArraySchema.parse(attached)).toThrow();
  });

  it("enforces depth, key length and object-key budgets at their boundaries", () => {
    const key128 = "k".repeat(128);
    const key129 = "k".repeat(129);
    const keys128 = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [`k${index}`, index]),
    );
    const keys129 = { ...keys128, overflow: true };

    expect(OpenRecordSchema.parse({ [key128]: true })).toBeDefined();
    expect(() => OpenRecordSchema.parse({ [key129]: true })).toThrow();
    expect(OpenRecordSchema.parse(keys128)).toBeDefined();
    expect(() => OpenRecordSchema.parse(keys129)).toThrow();
    expect(OpenRecordSchema.parse(nested(8))).toBeDefined();
    expect(() => OpenRecordSchema.parse(nested(9))).toThrow();
  });

  it("enforces per-string, aggregate-string and aggregate-value budgets", () => {
    const stringSchema = safeSchema(z.strictObject({ value: z.string() }));
    const strings = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`k${index}`, "x".repeat(2_000)]),
      );
    const groups = (count: number) => ({
      groups: Array.from({ length: count }, () => Array.from({ length: 128 }, () => 1)),
    });

    expect(stringSchema.parse({ value: "x".repeat(2_048) })).toBeDefined();
    expect(() => stringSchema.parse({ value: "x".repeat(2_049) })).toThrow();
    expect(OpenRecordSchema.parse(strings(32))).toBeDefined();
    expect(() => OpenRecordSchema.parse(strings(33))).toThrow();
    expect(OpenRecordSchema.parse(groups(15))).toBeDefined();
    expect(() => OpenRecordSchema.parse(groups(16))).toThrow();
  });

  it("returns deeply frozen empty-prototype snapshots", () => {
    const parsed = OpenRecordSchema.parse({ nested: { values: [1, 2] } }) as Record<
      string,
      unknown
    >;
    const nestedValue = parsed.nested as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(nestedValue)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(nestedValue)).toBe(true);
    expect(Object.isFrozen(nestedValue.values)).toBe(true);
  });

  it("rejects every non-finite number before downstream parsing", () => {
    const unknownSchema = safeSchema(z.unknown());
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => unknownSchema.parse(value)).toThrow();
    }
  });

  it("does not use poisoned Array.prototype methods after validation", () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map");
    const hostile = new Proxy([7], {
      getPrototypeOf(target) {
        Object.defineProperty(Array.prototype, "map", {
          configurable: true,
          value: () => [],
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });
    let parsed: readonly number[] | undefined;
    try {
      parsed = safeSchema(z.array(z.number()).min(1)).parse(hostile);
    } finally {
      if (originalMap) Object.defineProperty(Array.prototype, "map", originalMap);
    }
    expect(parsed).toEqual([7]);
  });
});
