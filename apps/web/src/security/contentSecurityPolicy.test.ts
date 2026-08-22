import { describe, expect, it } from "vitest";
import { PRODUCTION_CSP, shouldInjectProductionCsp } from "./contentSecurityPolicy";

describe("GitHub Pages content security policy", () => {
  it("allows only local runtime assets and omits unsupported meta directives", () => {
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:",
    );
    expect(PRODUCTION_CSP).not.toContain("frame-ancestors");
    expect(PRODUCTION_CSP).not.toMatch(/https?:\/\//u);
  });

  it("injects the policy only into production builds", () => {
    expect(shouldInjectProductionCsp("build")).toBe(true);
    expect(shouldInjectProductionCsp("serve")).toBe(false);
  });
});
