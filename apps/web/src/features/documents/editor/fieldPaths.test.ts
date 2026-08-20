import type { TemplateFieldManifestEntryV1 } from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import {
  deleteDraftField,
  getDraftField,
  parseRawFieldValue,
  setDraftField,
  updateDraftFromRaw,
} from "./fieldPaths";

function field(
  valueKind: TemplateFieldManifestEntryV1["valueKind"],
  overrides: Partial<TemplateFieldManifestEntryV1> = {},
): TemplateFieldManifestEntryV1 {
  return {
    path: "meta.value",
    section: "meta",
    label: "字段",
    control: "text",
    required: true,
    ...overrides,
    valueKind,
  } as TemplateFieldManifestEntryV1;
}

describe("safe manifest field paths", () => {
  it("updates a copied nested draft with null-prototype records", () => {
    const source = { project: { projectName: "旧名称" }, lineItems: [{ name: "商品一" }] };

    const updated = setDraftField(source, "project.projectName", "新名称");

    expect(getDraftField(updated, "project.projectName")).toBe("新名称");
    expect(source.project.projectName).toBe("旧名称");
    expect(Object.getPrototypeOf(updated)).toBeNull();
    expect(Object.getPrototypeOf(updated.project)).toBeNull();
    expect(updated.lineItems).not.toBe(source.lineItems);
    expect(updated.lineItems[0]).not.toBe(source.lineItems[0]);
  });

  it.each([
    "__proto__.polluted",
    "constructor.prototype.polluted",
    "prototype.value",
    "a.b.c.d.e.f.g.h.i.j.k.l.m",
    "items.500.name",
    "items.-1.name",
    "items.01.name",
  ])("rejects dangerous path %s", (path) => {
    expect(() => setDraftField({}, path, true)).toThrow("字段路径不安全");
  });

  it("rejects inherited and accessor-backed draft data without invoking getters", () => {
    const inherited = Object.create({ project: { projectName: "继承值" } }) as object;
    expect(() => setDraftField(inherited, "project.projectName", "新名称")).toThrow(
      "字段数据不安全",
    );

    const getter = vi.fn(() => ({ projectName: "读取了 getter" }));
    const accessor = {};
    Object.defineProperty(accessor, "project", { enumerable: true, get: getter });
    expect(() => setDraftField(accessor, "project.projectName", "新名称")).toThrow(
      "字段数据不安全",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects transparent proxies, sparse arrays, cycles and oversized graphs", () => {
    const proxy = new Proxy({ project: { projectName: "旧名称" } }, {});
    expect(() => setDraftField(proxy, "project.projectName", "新名称")).toThrow("字段数据不安全");

    const sparse = new Array<unknown>(2);
    sparse[1] = "only";
    expect(() => setDraftField({ sparse }, "value", true)).toThrow("字段数据不安全");

    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(() => setDraftField(cyclic, "value", true)).toThrow("字段数据不安全");

    const oversized = { values: Array.from({ length: 10_001 }, (_, index) => index) };
    expect(() => setDraftField(oversized, "value", true)).toThrow("字段数据不安全");
  });

  it("deletes only an own optional leaf without mutating its source", () => {
    const source = { meta: { optionalChoice: "old", retained: "keep" } };

    const updated = deleteDraftField(source, "meta.optionalChoice");

    expect(getDraftField(updated, "meta.optionalChoice")).toBeUndefined();
    expect(getDraftField(updated, "meta.retained")).toBe("keep");
    expect(source.meta.optionalChoice).toBe("old");
  });
});

describe("exact raw editor conversions", () => {
  it("converts localized text while preserving its other own language", () => {
    const current = Object.assign(Object.create(null) as Record<string, string>, {
      zhCN: "旧中文",
      enUS: "English",
    });
    expect(parseRawFieldValue(field("localized-text"), "新中文", current)).toEqual({
      zhCN: "新中文",
      enUS: "English",
    });
  });

  it.each([
    [field("string"), "  原样文本  ", undefined, "  原样文本  "],
    [field("integer", { control: "number" }), "42", undefined, 42],
    [field("decimal-string", { control: "number" }), "123.4500", undefined, "123.4500"],
    [field("money-minor", { control: "money" }), "123.45", undefined, "12345"],
    [field("basis-points", { control: "percent" }), "12.34", undefined, 1_234],
    [field("date", { control: "date" }), "2026-08-20", undefined, "2026-08-20"],
    [
      field("offset-datetime", { control: "datetime" }),
      "2026-08-21T11:45",
      "2026-08-20T10:30:00+08:00",
      "2026-08-21T11:45:00+08:00",
    ],
    [field("boolean", { control: "checkbox" }), true, undefined, true],
  ])("converts %s without floating-point drift", (manifest, raw, current, expected) => {
    expect(parseRawFieldValue(manifest, raw, current)).toEqual(expected);
  });

  it("accepts only declared enum values", () => {
    const manifest = field("enum", {
      control: "select",
      options: [
        { value: "CNY", label: "人民币" },
        { value: "USD", label: "美元" },
      ],
    });
    expect(parseRawFieldValue(manifest, "USD")).toBe("USD");
    expect(() => parseRawFieldValue(manifest, "EUR")).toThrow("字段值无效");
  });

  it.each([
    [field("integer", { control: "number" }), "1.5"],
    [field("money-minor", { control: "money" }), "1.001"],
    [field("basis-points", { control: "percent" }), "0.001"],
    [field("date", { control: "date" }), "2026-02-30"],
    [field("offset-datetime", { control: "datetime" }), "not-a-date"],
    [field("boolean", { control: "checkbox" }), "true"],
  ])("rejects an invalid raw value for %s", (manifest, raw) => {
    expect(() => parseRawFieldValue(manifest, raw)).toThrow("字段值无效");
  });

  it("deletes an optional select leaf instead of storing an empty string", () => {
    const source = { meta: { optionalChoice: "old", retained: "keep" } };
    const manifest = field("enum", {
      path: "meta.optionalChoice",
      control: "select",
      required: false,
      options: [{ value: "new", label: "新值" }],
    });

    const updated = updateDraftFromRaw(source, manifest, "");

    expect(getDraftField(updated, "meta.optionalChoice")).toBeUndefined();
    expect(getDraftField(updated, "meta.retained")).toBe("keep");
  });
});
