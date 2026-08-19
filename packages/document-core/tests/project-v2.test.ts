import { describe, expect, it, vi } from "vitest";
import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
  serializeProject,
} from "../src/index";
import {
  type ProjectEnvelopeV2,
  ProjectEnvelopeV2Schema,
  parseOpenTradProject,
  serializeProjectV2,
} from "../src/v2/index";

function createEnvelope(): ProjectEnvelopeV2 {
  return {
    formatVersion: "2.0.0",
    template: {
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft: {
      id: "service-quote-1",
      templateId: "quotation.service.project.v1",
      templateVersion: "1.0.0",
      customer: {
        legalName: "上海示例采购有限公司",
        milestones: ["需求确认", "验收交付"],
      },
    },
    presentation: {
      layoutStyleId: "modern-business.v1",
      languageView: "zh-CN",
    },
    attachmentManifest: [],
  };
}

function expectV2(project: ReturnType<typeof parseOpenTradProject>): ProjectEnvelopeV2 {
  if (project.formatVersion !== "2.0.0") {
    throw new Error("Expected a V2 project fixture");
  }
  return project;
}

function assertReadonlyEnvelope(envelope: ProjectEnvelopeV2): void {
  // @ts-expect-error Project identity is immutable public data.
  envelope.formatVersion = "1.0.0";
  // @ts-expect-error Nested template identity is immutable public data.
  envelope.template.version = "2.0.0";
  // @ts-expect-error Attachment manifests are immutable public data.
  envelope.attachmentManifest.push({});
}
void assertReadonlyEnvelope;

describe("ProjectEnvelopeV2", () => {
  it("round-trips an exact template version into isolated own-data output", () => {
    const input = createEnvelope();
    const parsed = expectV2(parseOpenTradProject(serializeProjectV2(input)));

    expect(parsed).toEqual(input);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(parsed.template)).toBeNull();
    expect(Object.getPrototypeOf(parsed.draft)).toBeNull();
    expect(Object.getPrototypeOf(parsed.draft.customer as object)).toBeNull();
    expect(Object.getPrototypeOf(parsed.presentation)).toBeNull();
  });

  it("serializes deterministically regardless of caller object-key insertion order", () => {
    const first = createEnvelope();
    const second = createEnvelope();
    first.draft.details = { beta: "二", alpha: "一" };
    second.draft.details = { alpha: "一", beta: "二" };

    expect(serializeProjectV2(first)).toBe(serializeProjectV2(second));
  });

  it.each([
    ["template id", { template: { ...createEnvelope().template, id: "quotation.unknown.v1" } }],
    ["template version", { template: { ...createEnvelope().template, version: "1.0.1" } }],
    ["basis date", { template: { ...createEnvelope().template, basisDate: "2026-08-20" } }],
    [
      "layout",
      { presentation: { ...createEnvelope().presentation, layoutStyleId: "unknown-layout.v1" } },
    ],
    ["language", { presentation: { ...createEnvelope().presentation, languageView: "fr-FR" } }],
  ])("rejects an inexact %s", (_label, patch) => {
    expect(() => serializeProjectV2({ ...createEnvelope(), ...patch })).toThrow();
  });

  it("rejects nested template identity mismatch", () => {
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        draft: { ...createEnvelope().draft, templateVersion: "1.0.1" },
      }),
    ).toThrow("项目包模板版本不一致");
  });

  it("reports a template-id mismatch at the draft templateId field", () => {
    const result = ProjectEnvelopeV2Schema.safeParse({
      ...createEnvelope(),
      draft: {
        ...createEnvelope().draft,
        templateId: "quotation.oem.custom.v1",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: "项目包模板版本不一致",
          path: ["draft", "templateId"],
        }),
      );
    }
  });

  it("rejects unknown envelope, template, presentation and attachment keys", () => {
    expect(() =>
      serializeProjectV2({ ...createEnvelope(), calculation: { total: "999" } }),
    ).toThrow();
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        template: { ...createEnvelope().template, unknown: true },
      }),
    ).toThrow();
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        presentation: { ...createEnvelope().presentation, unknown: true },
      }),
    ).toThrow();
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        attachmentManifest: [
          {
            id: "technical-specification",
            category: "technical",
            displayName: "技术规格书",
            mediaType: "application/pdf",
            required: true,
            status: "attached",
            includedInSubmission: true,
            unknown: true,
          },
        ],
      }),
    ).toThrow();
  });

  it("validates and preserves an exact attachment manifest", () => {
    const input = {
      ...createEnvelope(),
      attachmentManifest: [
        {
          id: "technical-specification",
          category: "technical" as const,
          displayName: "技术规格书",
          mediaType: "application/pdf" as const,
          pageCount: 8,
          required: true,
          sourceRef: "tender-section-4",
          localBlobKey: "blob-technical-specification",
          status: "attached" as const,
          includedInSubmission: true,
        },
      ],
    };

    expect(expectV2(parseOpenTradProject(serializeProjectV2(input))).attachmentManifest).toEqual(
      input.attachmentManifest,
    );
  });

  it("accepts XML-safe surrogate pairs while rejecting isolated surrogates", () => {
    const attachment = {
      id: "product-image",
      category: "technical" as const,
      displayName: "产品图片 😀",
      mediaType: "image/png" as const,
      required: false,
      status: "attached" as const,
      includedInSubmission: false,
    };

    expect(() =>
      serializeProjectV2({ ...createEnvelope(), attachmentManifest: [attachment] }),
    ).not.toThrow();
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        attachmentManifest: [{ ...attachment, displayName: "invalid\ud800" }],
      }),
    ).toThrow();
  });

  it("rejects a trailing isolated high surrogate while parsing a V2 project envelope", () => {
    const envelope = {
      ...createEnvelope(),
      attachmentManifest: [
        {
          id: "product-image",
          category: "technical" as const,
          displayName: "无效末尾\ud800",
          mediaType: "image/png" as const,
          required: false,
          status: "attached" as const,
          includedInSubmission: false,
        },
      ],
    };

    expect(() => parseOpenTradProject(JSON.stringify(envelope))).toThrow();
  });

  it("normalizes explicitly undefined optional attachment fields to omission", () => {
    const attachment = {
      id: "qualification-certificate",
      category: "qualification" as const,
      displayName: "资质证书",
      mediaType: "application/pdf" as const,
      required: true,
      status: "attached" as const,
      includedInSubmission: true,
    };
    const omitted = { ...createEnvelope(), attachmentManifest: [attachment] };
    const explicit = {
      ...createEnvelope(),
      attachmentManifest: [
        {
          ...attachment,
          pageCount: undefined,
          sourceRef: undefined,
          localBlobKey: undefined,
        },
      ],
    };

    expect(serializeProjectV2(explicit)).toBe(serializeProjectV2(omitted));
  });

  it.each(["../escape", "a/b", "a\\b", ".", ".."])(
    "rejects attachment id %s as an unsafe archive path segment",
    (id) => {
      expect(() =>
        serializeProjectV2({
          ...createEnvelope(),
          attachmentManifest: [
            {
              id,
              category: "other",
              displayName: "附件",
              mediaType: "application/pdf",
              required: false,
              status: "attached",
              includedInSubmission: false,
            },
          ],
        }),
      ).toThrow();
    },
  );

  it("rejects more than 100 attachments before reading their elements", () => {
    let numericReads = 0;
    const attachments = new Proxy(new Array(101), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      ProjectEnvelopeV2Schema.safeParse({
        ...createEnvelope(),
        attachmentManifest: attachments,
      }).success,
    ).toBe(false);
    expect(numericReads).toBe(0);
  });

  it("rejects excessive depth and strings above 16,384 characters", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index < 20; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        draft: { ...createEnvelope().draft, deeplyNested },
      }),
    ).toThrow(/depth/);
    expect(() =>
      serializeProjectV2({
        ...createEnvelope(),
        draft: { ...createEnvelope().draft, overlong: "x".repeat(16_385) },
      }),
    ).toThrow(/string/i);
  });

  it("rejects UTF-8 project text above 1 MiB before JSON parsing", () => {
    const oversized = `{"formatVersion":"2.0.0","padding":"${"汉".repeat(400_000)}"}`;
    expect(oversized.length).toBeLessThan(1_048_576);
    expect(() => parseOpenTradProject(oversized)).toThrow(/1 MiB/);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects dangerous own key %s without prototype pollution",
    (key) => {
      const hostile = createEnvelope() as unknown as Record<string, unknown>;
      Object.defineProperty(hostile, key, {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });

      expect(ProjectEnvelopeV2Schema.safeParse(hostile).success).toBe(false);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    },
  );

  it("rejects inherited and accessor-backed input without invoking accessors", () => {
    expect(ProjectEnvelopeV2Schema.safeParse(Object.create(createEnvelope())).success).toBe(false);

    const getter = vi.fn(() => createEnvelope().draft);
    const hostile = createEnvelope() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "draft", { enumerable: true, get: getter });
    expect(ProjectEnvelopeV2Schema.safeParse(hostile).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it("turns throwing and revoked Proxy traps into exported-schema failures", () => {
    const throwing = new Proxy(createEnvelope(), {
      ownKeys() {
        throw new Error("malicious ownKeys trap");
      },
    });
    const revoked = Proxy.revocable(createEnvelope(), {});
    revoked.revoke();

    expect(() => ProjectEnvelopeV2Schema.safeParse(throwing)).not.toThrow();
    expect(ProjectEnvelopeV2Schema.safeParse(throwing).success).toBe(false);
    expect(() => ProjectEnvelopeV2Schema.safeParse(revoked.proxy)).not.toThrow();
    expect(ProjectEnvelopeV2Schema.safeParse(revoked.proxy).success).toBe(false);
  });

  it("dispatches V1 to the existing parser and recomputes its derived calculation", () => {
    const draft: StandardGoodsQuoteDraft = createStandardGoodsQuoteDraft({
      id: "project-v1-dispatch",
      now: "2026-08-19T00:00:00.000Z",
    });
    const payload = JSON.parse(serializeProject(draft)) as {
      calculation: { lines: Array<{ totalMinor: string }>; summary: { totalMinor: string } };
    };
    const firstLine = payload.calculation.lines[0];
    if (!firstLine) throw new Error("Expected a V1 calculation fixture");
    firstLine.totalMinor = "999999999";
    payload.calculation.summary.totalMinor = "999999999";

    const parsed = parseOpenTradProject(JSON.stringify(payload));
    expect(parsed.formatVersion).toBe("1.0.0");
    if (parsed.formatVersion === "1.0.0") {
      expect(parsed.calculation.lines[0]?.totalMinor).toBe("0");
      expect(parsed.calculation.summary.totalMinor).toBe("0");
    }
  });

  it("rejects invalid JSON, unknown formats and non-string parser input", () => {
    expect(() => parseOpenTradProject("not-json")).toThrow("项目包不是有效的 JSON");
    expect(() => parseOpenTradProject('{"formatVersion":"3.0.0"}')).toThrow(
      "不支持的项目包格式版本",
    );
    expect(() => parseOpenTradProject({} as never)).toThrow("项目包必须是 JSON 字符串");
  });
});
