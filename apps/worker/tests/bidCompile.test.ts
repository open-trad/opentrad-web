import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { BidPolicyError } from "../src/policies/bidArchive.js";
import {
  compileCanonicalBidProject,
  createBidCompileRuntime,
  requireBidCompileSnapshot,
} from "../src/policies/bidCompile.js";

const encoder = new TextEncoder();
const READY_NOW = Date.parse("2026-08-20T04:00:00.000Z");
const bidCases = [
  ["bid.government.goods.v1", "bid-government-goods"],
  ["bid.government.services.v1", "bid-government-services"],
  ["bid.construction.works.v1", "bid-construction-works"],
  ["bid.enterprise.goods.v1", "bid-enterprise-goods"],
  ["bid.enterprise.services.v1", "bid-enterprise-services"],
] as const;

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../packages/document-core/tests/fixtures/v2/${name}.json`, import.meta.url),
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function envelope(
  templateId: string,
  fixtureName: string,
  draftOverride?: Record<string, unknown>,
) {
  const draft = { ...fixture(fixtureName), ...draftOverride };
  const attachments = (draft.attachments as Array<Record<string, unknown>>).map(
    ({ localBlobKey: _localBlobKey, ...attachment }) => attachment,
  );
  return {
    formatVersion: "2.0.0",
    template: { id: templateId, version: "1.0.0", basisDate: "2026-08-19" },
    draft,
    presentation: {
      layoutStyleId: templateId.startsWith("bid.enterprise.")
        ? "modern-business.v1"
        : "classic-formal.v1",
      languageView: "zh-CN",
    },
    attachmentManifest: attachments,
  };
}

function bytes(value: unknown): Uint8Array {
  return encoder.encode(stableJson(value));
}

function request(templateId: string) {
  return { templateId, templateVersion: "1.0.0" } as const;
}

function runtime(now = READY_NOW) {
  return createBidCompileRuntime({ now: vi.fn(() => now) });
}

function expectFixedFailure(error: unknown): boolean {
  return (
    error instanceof BidPolicyError &&
    error.code === "INVALID_REQUEST" &&
    error.message === "INVALID_REQUEST"
  );
}

describe("bid V2 registry preflight and compile", () => {
  for (const [templateId, fixtureName] of bidCases) {
    it(`compiles ${templateId} through its exact registration with gold semantic parity`, () => {
      const source = envelope(templateId, fixtureName);
      const trustedRuntime = runtime();
      const result = compileCanonicalBidProject(bytes(source), request(templateId), trustedRuntime);
      const gold = JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(
              `../../../tests/golds/templates-v2/artifacts/${templateId}/default.model.json`,
              import.meta.url,
            ),
          ),
          "utf8",
        ),
      );

      expect(result.model).toEqual(gold);
      expect(result.model.template).toEqual(source.template);
      expect(result.model.documentId).toBe((source.draft as Record<string, unknown>).id);
      expect(result.language).toBe(source.presentation.languageView);
      expect(result.layoutStyleId).toBe(source.presentation.layoutStyleId);
      expect(result.asOf).toBe("2026-08-20T04:00:00.000Z");
      expect(Object.getPrototypeOf(result)).toBeNull();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.model)).toBe(true);
      expect(trustedRuntime.now).toHaveBeenCalledTimes(1);
    });
  }

  it("accepts a ready submission and rejects every blockSubmission finding", () => {
    const templateId = "bid.government.goods.v1";
    expect(() =>
      compileCanonicalBidProject(
        bytes(envelope(templateId, "bid-government-goods")),
        request(templateId),
        runtime(),
      ),
    ).not.toThrow();
    const blocked = envelope(templateId, "bid-government-goods", {
      priceDeclaration: {
        itemizedTotalMinor: "1000000",
        bidLetterTotalMinor: "1000000",
        openingTotalMinor: "1000000",
        userConfirmed: false,
      },
    });
    awaitFixed(() => compileCanonicalBidProject(bytes(blocked), request(templateId), runtime()));
  });

  it("rejects an expired deadline using trusted now rather than draft/client time", () => {
    const templateId = "bid.government.goods.v1";
    const source = envelope(templateId, "bid-government-goods", {
      updatedAt: "2035-01-01T00:00:00Z",
    });
    expect(() =>
      compileCanonicalBidProject(
        bytes(source),
        request(templateId),
        runtime(Date.parse("2026-09-10T01:00:00.000Z")),
      ),
    ).toThrow(BidPolicyError);
  });

  it.each([
    ["unknown template", { templateId: "bid.unknown.v1", templateVersion: "1.0.0" }],
    ["unknown version", { templateId: "bid.government.goods.v1", templateVersion: "1.0.1" }],
    [
      "non-bid registration",
      { templateId: "quotation.service.project.v1", templateVersion: "1.0.0" },
    ],
  ])("uses no registry fallback for %s", (_label, invalidRequest) => {
    expect(() =>
      compileCanonicalBidProject(
        bytes(envelope("bid.government.goods.v1", "bid-government-goods")),
        invalidRequest as never,
        runtime(),
      ),
    ).toThrow(BidPolicyError);
  });

  it("requires exact canonical V2 UTF-8 bytes", () => {
    const source = envelope("bid.government.goods.v1", "bid-government-goods");
    const noncanonical = encoder.encode(JSON.stringify(source, null, 2));
    expect(() =>
      compileCanonicalBidProject(noncanonical, request("bid.government.goods.v1"), runtime()),
    ).toThrow(BidPolicyError);
    expect(() =>
      compileCanonicalBidProject(
        encoder.encode('{"formatVersion":"1.0.0"}'),
        request("bid.government.goods.v1"),
        runtime(),
      ),
    ).toThrow(BidPolicyError);
    expect(() =>
      compileCanonicalBidProject(
        Uint8Array.from([0xff]),
        request("bid.government.goods.v1"),
        runtime(),
      ),
    ).toThrow(BidPolicyError);
  });

  it("reparses the registration draft and rejects template, basis, language, layout and attachment mismatches", () => {
    const templateId = "bid.government.goods.v1";
    const base = envelope(templateId, "bid-government-goods");
    const mutations = [
      { ...base, template: { ...base.template, id: "bid.enterprise.goods.v1" } },
      { ...base, template: { ...base.template, basisDate: "2026-08-20" } },
      { ...base, presentation: { ...base.presentation, languageView: "en-US" } },
      { ...base, presentation: { ...base.presentation, layoutStyleId: "modern-business.v1" } },
      { ...base, attachmentManifest: (base.attachmentManifest as unknown[]).slice(1) },
      { ...base, draft: { ...base.draft, unknown: true } },
    ];
    for (const mutation of mutations) {
      expect(() =>
        compileCanonicalBidProject(bytes(mutation), request(templateId), runtime()),
      ).toThrow(BidPolicyError);
    }
  });

  it("keeps ordinary evidence citations but strips attachment URI refs without fetching", () => {
    const templateId = "bid.government.goods.v1";
    const base = envelope(templateId, "bid-government-goods");
    const attachments = (base.attachmentManifest as Array<Record<string, unknown>>).map(
      (entry, index) =>
        index === 1 ? { ...entry, sourceRef: "https://example.invalid/private.pdf" } : entry,
    );
    const draftAttachments = (
      (base.draft as Record<string, unknown>).attachments as Array<Record<string, unknown>>
    ).map((entry, index) =>
      index === 1 ? { ...entry, sourceRef: "https://example.invalid/private.pdf" } : entry,
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = compileCanonicalBidProject(
      bytes({
        ...base,
        draft: { ...base.draft, attachments: draftAttachments },
        attachmentManifest: attachments,
      }),
      request(templateId),
      runtime(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(JSON.stringify(result.model)).not.toContain("example.invalid");
    expect(JSON.stringify(result.model)).toContain("第三章 技术要求 2.1");

    const local = {
      ...base,
      attachmentManifest: attachments.map((entry, index) =>
        index === 0 ? { ...entry, localBlobKey: "private-local-key" } : entry,
      ),
    };
    expect(() => compileCanonicalBidProject(bytes(local), request(templateId), runtime())).toThrow(
      BidPolicyError,
    );
  });

  it("does not trust body.pageCount and does not add attachmentPage blocks", () => {
    const templateId = "bid.government.goods.v1";
    const source = envelope(templateId, "bid-government-goods") as Record<string, unknown>;
    source.body = { pageCount: 9999 };
    expect(() => compileCanonicalBidProject(bytes(source), request(templateId), runtime())).toThrow(
      BidPolicyError,
    );
    const result = compileCanonicalBidProject(
      bytes(envelope(templateId, "bid-government-goods")),
      request(templateId),
      runtime(),
    );
    expect(
      result.model.sections
        .flatMap((section) => section.blocks)
        .some((block) => block.type === "attachmentPage"),
    ).toBe(false);
  });

  it("does not mutate input and rejects proxies, accessors, prototype pollution and unbranded runtime", () => {
    const templateId = "bid.government.goods.v1";
    const input = bytes(envelope(templateId, "bid-government-goods"));
    const before = input.slice();
    compileCanonicalBidProject(input, request(templateId), runtime());
    expect(input).toEqual(before);
    expect(() =>
      compileCanonicalBidProject(new Proxy(input, {}), request(templateId), runtime()),
    ).toThrow(BidPolicyError);
    const getter = vi.fn(() => templateId);
    const hostileRequest = { templateVersion: "1.0.0" } as Record<string, unknown>;
    Object.defineProperty(hostileRequest, "templateId", { enumerable: true, get: getter });
    expect(() => compileCanonicalBidProject(input, hostileRequest as never, runtime())).toThrow(
      BidPolicyError,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      compileCanonicalBidProject(
        input,
        Object.assign(Object.create({ templateId }), request(templateId)),
        runtime(),
      ),
    ).toThrow(BidPolicyError);
    expect(() =>
      compileCanonicalBidProject(input, request(templateId), { now: () => READY_NOW } as never),
    ).toThrow(BidPolicyError);
  });

  it("captures one finite trusted time and maps runtime failures to the fixed error", () => {
    const input = bytes(envelope("bid.government.goods.v1", "bid-government-goods"));
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 9e99]) {
      expect(() =>
        compileCanonicalBidProject(input, request("bid.government.goods.v1"), runtime(now)),
      ).toThrow(BidPolicyError);
    }
    const throwing = createBidCompileRuntime({
      now: () => {
        throw new Error("private-sentinel");
      },
    });
    let failure: unknown;
    try {
      compileCanonicalBidProject(input, request("bid.government.goods.v1"), throwing);
    } catch (error) {
      failure = error;
    }
    expect(failure).toSatisfy(expectFixedFailure);
    expect(String(failure)).not.toContain("sentinel");
  });

  it("keeps runtime and snapshot brands private after WeakSet prototype poisoning", () => {
    const templateId = "bid.government.goods.v1";
    const input = bytes(envelope(templateId, "bid-government-goods"));
    const trustedRuntime = runtime();
    const trustedSnapshot = compileCanonicalBidProject(input, request(templateId), trustedRuntime);
    const originalHas = WeakSet.prototype.has;
    const originalAdd = WeakSet.prototype.add;
    let forgedAccepted = false;
    let runtimeFailure: unknown;
    let genuineFailure: unknown;
    try {
      WeakSet.prototype.has = () => true;
      WeakSet.prototype.add = () => {
        throw new Error("PRIVATE_WEAKSET_SENTINEL");
      };
      try {
        requireBidCompileSnapshot(Object.create(null));
        forgedAccepted = true;
      } catch {
        // A forged object must remain outside the module-private brand.
      }
      try {
        createBidCompileRuntime({ now: () => READY_NOW });
      } catch (error) {
        runtimeFailure = error;
      }
      try {
        requireBidCompileSnapshot(trustedSnapshot);
      } catch (error) {
        genuineFailure = error;
      }
    } finally {
      WeakSet.prototype.has = originalHas;
      WeakSet.prototype.add = originalAdd;
    }
    expect(forgedAccepted).toBe(false);
    expect(runtimeFailure).toBeUndefined();
    expect(genuineFailure).toBeUndefined();
  });
});

function awaitFixed(run: () => unknown): void {
  let failure: unknown;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toSatisfy(expectFixedFailure);
}
