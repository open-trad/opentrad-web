import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("built package strict CSP", () => {
  it("imports and executes every public flow without dynamic Function generation", () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const entryUrl = `${pathToFileURL(`${packageRoot}dist/index.js`).href}?csp=${Date.now()}`;
    const probe = `
      let functionCalls = 0;
      globalThis.Function = function ForbiddenDynamicFunction() {
        functionCalls += 1;
        throw new Error("dynamic Function generation is forbidden");
      };
      let indirectConstructorBlocked = false;
      try {
        (() => {}).constructor("return 7")();
      } catch {
        indirectConstructorBlocked = true;
      }
      if (!indirectConstructorBlocked) {
        throw new Error("V8 string code generation guard is not active");
      }
      const core = await import(${JSON.stringify(entryUrl)});
      const draft = core.createStandardGoodsQuoteDraft({
        id: "csp-probe",
        now: "2026-08-19T00:00:00.000Z",
      });
      const parsed = core.DocumentDraftSchema.parse(draft);
      const calculation = core.calculateQuoteTotals(parsed);
      const model = core.compileStandardGoodsQuote(parsed);
      const serialized = core.serializeProject(parsed);
      const project = core.parseProject(serialized);
      if (functionCalls !== 0 || calculation.lines.length !== 1 || model.nodes.length < 1 || project.draft.id !== draft.id) {
        process.exitCode = 2;
      } else {
        process.stdout.write(JSON.stringify({ functionCalls, total: calculation.summary.totalMinor }));
      }
    `;

    const result = spawnSync(
      process.execPath,
      ["--disallow-code-generation-from-strings", "--input-type=module", "--eval", probe],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ functionCalls: 0, total: "0" });
  });
});
