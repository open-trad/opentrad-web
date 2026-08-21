import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("worker main package gate", () => {
  it("keeps the build-first native queue dispatcher smoke in the standard worker test", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    expect(packageJson.scripts?.["test:native-main"]).toBe(
      "pnpm --filter @opentrad/api build && pnpm build && node tests/main-native-smoke.mjs",
    );
    expect(packageJson.scripts?.test).toBe("vitest run && pnpm test:native-main");
    expect(packageJson.scripts?.start).toBe("node dist/main.js");
  });
});
