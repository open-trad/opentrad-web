import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactOrientations,
  assertManifestMatrix,
  assertOrientationRuns,
  assertSemanticDigestText,
  collectStaticText,
} from "./gold-verification-helpers.mjs";

const registrations = Array.from({ length: 15 }, (_, index) => ({
  id: `template-${index + 1}`,
  version: "1.0.0",
}));

test("manifest matrix rejects omitted and duplicate launch registrations", () => {
  assert.doesNotThrow(() => assertManifestMatrix(registrations, registrations));
  assert.throws(
    () => assertManifestMatrix(registrations.slice(0, 14), registrations),
    /Manifest must contain exactly 15 templates/u,
  );
  assert.throws(
    () => assertManifestMatrix([...registrations.slice(0, 14), registrations[0]], registrations),
    /Manifest contains duplicate template ids/u,
  );
});

test("semantic plan verification rejects a dropped user value", () => {
  assert.throws(
    () => assertSemanticDigestText("标题\n客户哨兵", "标题", "PDF plan"),
    /PDF plan is missing semantic text: 客户哨兵/u,
  );
  assert.doesNotThrow(() =>
    assertSemanticDigestText("标题\n客户哨兵", "标题 客户哨兵", "PDF plan"),
  );
});

test("static plan text walks nested content but ignores renderer callbacks", () => {
  assert.equal(
    collectStaticText({
      content: [{ text: "标题" }, { table: { body: [["客户哨兵"]] } }],
      footer: () => "页脚",
    }),
    "标题\n客户哨兵",
  );
});

test("DOCX sections require the exact declared orientation sequence", () => {
  assert.throws(
    () =>
      assertExactOrientations(
        ["portrait", "landscape"],
        ["portrait", "landscape", "portrait"],
        "DOCX",
      ),
    /DOCX orientation sequence/u,
  );
});

test("PDF pages require the declared orientation runs in order", () => {
  assert.doesNotThrow(() =>
    assertOrientationRuns(
      ["portrait", "portrait", "landscape", "landscape", "portrait"],
      ["portrait", "landscape", "portrait"],
      "PDF",
    ),
  );
  assert.throws(
    () =>
      assertOrientationRuns(
        ["portrait", "landscape", "portrait"],
        ["portrait", "portrait", "landscape"],
        "PDF",
      ),
    /PDF orientation runs/u,
  );
});
