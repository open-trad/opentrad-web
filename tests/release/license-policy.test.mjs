import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLicenses } from "../../scripts/release/check-licenses.mjs";

test("license policy accepts reviewed AGPL-compatible runtime licenses", () => {
  const result = evaluateLicenses([
    { name: "permissive", license: "MIT" },
    { name: "dual", license: "(MIT OR GPL-3.0-or-later)" },
    { name: "duck", license: "BSD" },
  ]);
  assert.equal(result.ok, true);
});

test("license policy fails closed on restricted and unknown terms", () => {
  const result = evaluateLicenses([
    { name: "restricted", license: "SSPL-1.0" },
    { name: "unknown", license: "LicenseRef-Proprietary" },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.rejected.map(({ name }) => name),
    ["restricted", "unknown"],
  );
});
