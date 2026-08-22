// @vitest-environment node

import { relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listFilesRecursively,
  monitorPrivateLocalNetwork,
  repositoryRoot,
} from "../../../e2e/helpers";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { history: { replaceState: () => undefined } },
});

interface FakeRequest {
  readonly body?: Buffer;
  readonly headers?: Record<string, string>;
  readonly method?: string;
  readonly url: string;
}

function observe(input: FakeRequest, sentinels: readonly string[]): string[] {
  let listener: ((request: unknown) => void) | undefined;
  const page = {
    on: (event: string, callback: (request: unknown) => void) => {
      if (event === "request") listener = callback;
    },
  };
  const violations = monitorPrivateLocalNetwork(page as never, sentinels);
  listener?.({
    headers: () => input.headers ?? {},
    method: () => input.method ?? "GET",
    postDataBuffer: () => input.body ?? null,
    url: () => input.url,
  });
  return violations;
}

function exactBuiltAsset(): string {
  const root = `${repositoryRoot}/apps/web/dist`;
  const file = listFilesRecursively(root).find((path) => path.includes(`${sep}assets${sep}`));
  if (!file) throw new Error("BUILT_ASSET_REQUIRED");
  return `/${relative(root, file).split(sep).join("/")}`;
}

describe("local conversion network privacy monitor", () => {
  it("rejects a same-origin asset-prefix URL that is absent from the exact build", () => {
    expect(
      observe({ url: "https://opentrad.dns.army:4173/assets/not-in-this-build.js" }, []),
    ).toEqual(["GET https://opentrad.dns.army:4173/assets/not-in-this-build.js"]);
  });

  it("detects encoded sentinels on an otherwise allowed exact asset request", () => {
    const sentinel = "private-local-采购清单";
    const encoded = Buffer.from(sentinel, "utf8").toString("base64url");
    const path = exactBuiltAsset();
    expect(
      observe(
        {
          headers: { "x-private": encoded },
          url: `https://opentrad.dns.army:4173${path}`,
        },
        [sentinel],
      ),
    ).toContain(`private sentinel in ${path}`);
  });
});
