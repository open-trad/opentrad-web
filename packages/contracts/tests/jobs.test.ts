import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "../src/index.js";
import { createIdempotencyShape as createTypedIdempotencyShape } from "../src/index.js";

const api = contracts as Record<string, unknown>;
const MiB = 1024 * 1024;
const BID_TEMPLATE_ID = "bid.government.goods.v1";

function schema(name: string): { parse(input: unknown): unknown } {
  return api[name] as { parse(input: unknown): unknown };
}

function jobRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operation: "office.to.pdf",
    inputFormat: "docx",
    outputFormat: "pdf",
    inputBytes: 12,
    options: {},
    ...overrides,
  };
}

function attachment(index: number, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `attachment-${index}`,
    category: "technical",
    displayName: `附件 ${index}`,
    mediaType: "application/pdf",
    byteLength: 1024,
    pageCount: 1,
    required: false,
    status: "attached",
    includedInSubmission: true,
    ...overrides,
  };
}

function unavailableAttachment(
  index: number,
  status: "missing" | "rejected",
  includedInSubmission: boolean,
) {
  const { byteLength: _byteLength, pageCount: _pageCount, ...descriptor } = attachment(index);
  return { ...descriptor, status, includedInSubmission };
}

function bidManifest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    templateId: BID_TEMPLATE_ID,
    templateVersion: "1.0.0",
    body: { byteLength: 1024, pageCount: 2 },
    attachmentManifest: [attachment(1)],
    ...overrides,
  };
}

describe("job privacy and operation contracts", () => {
  it("rejects source filenames, document bodies and content hashes", () => {
    for (const extra of [
      { sourceFilename: "secret.docx" },
      { body: "private text" },
      { contentHash: "sha256:private" },
    ]) {
      expect(() => schema("CreateJobRequestSchema").parse(jobRequest(extra))).toThrow();
    }

    const now = new Date().toISOString();
    expect(() =>
      schema("JobStatusSchema").parse({
        id: crypto.randomUUID(),
        operation: "office.to.pdf",
        status: "queued",
        quality: "B",
        createdAt: now,
        expiresAt: now,
        body: "private text",
      }),
    ).toThrow();
  });

  it("accepts only operation-specific formats and allowlisted options", () => {
    expect(
      schema("CreateJobRequestSchema").parse(
        jobRequest({
          operation: "ocr.pdf",
          inputFormat: "pdf",
          outputFormat: "txt",
          options: { language: "chi_sim+eng" },
        }),
      ),
    ).toBeDefined();
    expect(() =>
      schema("CreateJobRequestSchema").parse(
        jobRequest({ outputFormat: "md", options: { writer: "--lua-filter=evil.lua" } }),
      ),
    ).toThrow();
  });

  it("builds a frozen idempotency shape from operation, formats, bytes and allowlisted options", () => {
    const createIdempotencyShape = api.createIdempotencyShape as
      | ((input: unknown) => Record<string, unknown>)
      | undefined;
    const shape = createIdempotencyShape?.(
      jobRequest({
        inputBytes: 4096,
        options: {},
      }),
    );
    expect(shape).toEqual({
      operation: "office.to.pdf",
      inputFormat: "docx",
      outputFormat: "pdf",
      inputBytes: 4096,
      options: {},
    });
    expect(shape).not.toHaveProperty("sourceFilename");
    expect(shape).not.toHaveProperty("body");
    expect(shape).not.toHaveProperty("contentHash");
    expect(Object.getPrototypeOf(shape as object)).toBeNull();
    expect(Object.isFrozen(shape)).toBe(true);
    expect(Object.isFrozen(shape?.options)).toBe(true);
    expect(createIdempotencyShape?.(jobRequest({ inputBytes: 4097 }))).not.toEqual(shape);
    expectTypeOf(createTypedIdempotencyShape(jobRequest()).inputBytes).toEqualTypeOf<number>();
  });

  it("keeps idempotency options correlated with the selected operation", () => {
    expect(() =>
      schema("IdempotencyShapeSchema").parse({
        operation: "office.to.pdf",
        inputFormat: "docx",
        outputFormat: "pdf",
        inputBytes: 12,
        options: { language: "eng" },
      }),
    ).toThrow();
  });

  it("keeps every server capability, create request and idempotency branch in parity", () => {
    const cases = [
      jobRequest(),
      jobRequest({
        operation: "spreadsheet.to.csv",
        inputFormat: "xlsx",
        outputFormat: "csv",
        options: { sheetIndex: 0 },
      }),
      jobRequest({
        operation: "structured.convert",
        inputFormat: "docx",
        outputFormat: "md",
      }),
      jobRequest({ operation: "ocr.pdf", inputFormat: "pdf", outputFormat: "txt" }),
      jobRequest({ operation: "ocr.image", inputFormat: "png", outputFormat: "pdf" }),
      jobRequest({
        operation: "image.convert.hq",
        inputFormat: "png",
        outputFormat: "webp",
      }),
      jobRequest({ operation: "pdf.repair", inputFormat: "pdf", outputFormat: "pdf" }),
      jobRequest({ operation: "pdf.text-to-docx", inputFormat: "pdf", outputFormat: "docx" }),
      jobRequest({
        operation: "bid.assemble",
        inputFormat: "opentrad",
        outputFormat: "pdf",
        options: { templateId: BID_TEMPLATE_ID, templateVersion: "1.0.0" },
      }),
    ];
    const serverCapabilityIds = (api.CAPABILITIES as readonly Record<string, unknown>[])
      .filter((capability) => capability.execution === "server")
      .map((capability) => capability.id);
    const operationOptions = (api.ConversionOperationSchema as { options: readonly string[] })
      .options;
    expect(operationOptions).toEqual(serverCapabilityIds);

    const createIdempotencyShape = api.createIdempotencyShape as (input: unknown) => unknown;
    for (const item of cases) {
      const request = schema("CreateJobRequestSchema").parse(item);
      const shape = createIdempotencyShape(request);
      expect(schema("IdempotencyShapeSchema").parse(shape)).toEqual(shape);
    }

    const formats = (api.FileFormatSchema as { options: readonly string[] }).options;
    const createSchema = api.CreateJobRequestSchema as {
      safeParse(input: unknown): { success: boolean };
    };
    const idempotencySchema = api.IdempotencyShapeSchema as {
      safeParse(input: unknown): { success: boolean };
    };
    for (const capability of (api.CAPABILITIES as readonly Record<string, unknown>[]).filter(
      (item) => item.execution === "server",
    )) {
      const operation = capability.id as string;
      const inputFormats = capability.inputFormats as readonly string[];
      const outputFormats = capability.outputFormats as readonly string[];
      const options =
        operation === "bid.assemble"
          ? { templateId: BID_TEMPLATE_ID, templateVersion: "1.0.0" }
          : {};
      for (const inputFormat of formats) {
        for (const outputFormat of formats) {
          const candidate = { operation, inputFormat, outputFormat, inputBytes: 12, options };
          const expected =
            inputFormats.includes(inputFormat) && outputFormats.includes(outputFormat);
          expect(
            createSchema.safeParse(candidate).success,
            `${operation}:${inputFormat}->${outputFormat}`,
          ).toBe(expected);
          expect(
            idempotencySchema.safeParse(candidate).success,
            `idempotency:${operation}:${inputFormat}->${outputFormat}`,
          ).toBe(expected);
        }
      }
    }
  });
});

describe("bid assembly contract", () => {
  it("accepts only known bid template versions and canonical archive formats", () => {
    expect(
      schema("CreateJobRequestSchema").parse({
        operation: "bid.assemble",
        inputFormat: "opentrad",
        outputFormat: "pdf",
        inputBytes: 52 * MiB,
        options: { templateId: BID_TEMPLATE_ID, templateVersion: "1.0.0" },
      }),
    ).toBeDefined();
    for (const invalid of [
      { inputFormat: "docx" },
      { outputFormat: "png" },
      { inputBytes: 52 * MiB + 1 },
      { options: { templateId: "bid.unknown.v1", templateVersion: "1.0.0" } },
      { options: { templateId: BID_TEMPLATE_ID, templateVersion: "1.0.1" } },
    ]) {
      expect(() =>
        schema("CreateJobRequestSchema").parse({
          operation: "bid.assemble",
          inputFormat: "opentrad",
          outputFormat: "pdf",
          inputBytes: 1024,
          options: { templateId: BID_TEMPLATE_ID, templateVersion: "1.0.0" },
          ...invalid,
        }),
      ).toThrow();
    }
  });

  it("models a body and up to 100 portable attachment descriptors", () => {
    const parsed = schema("BidAssemblyManifestSchema").parse(
      bidManifest({
        attachmentManifest: Array.from({ length: 100 }, (_, index) =>
          attachment(index, { includedInSubmission: index < 40 }),
        ),
      }),
    ) as Record<string, unknown>;
    expect((parsed.attachmentManifest as readonly unknown[]).length).toBe(100);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.attachmentManifest)).toBe(true);
  });

  it("enforces business attachment, byte and total-page budgets", () => {
    const cases = [
      Array.from({ length: 41 }, (_, index) => attachment(index)),
      [attachment(1, { byteLength: 25 * MiB + 1 })],
      [
        attachment(1, { byteLength: 25 * MiB }),
        attachment(2, { byteLength: 25 * MiB }),
        attachment(3, { byteLength: 1 }),
      ],
      [attachment(1, { pageCount: 79 })],
    ];
    for (const attachmentManifest of cases) {
      expect(() =>
        schema("BidAssemblyManifestSchema").parse(bidManifest({ attachmentManifest })),
      ).toThrow();
    }
  });

  it("keeps sourceRef as opaque citation data with no network-fetch field", () => {
    for (const sourceRef of ["第三章/2.1", "https://example.invalid/solicitation.pdf#page=18"]) {
      const parsed = schema("BidAssemblyManifestSchema").parse(
        bidManifest({ attachmentManifest: [attachment(1, { sourceRef })] }),
      ) as { readonly attachmentManifest: readonly { readonly sourceRef?: string }[] };
      expect(parsed.attachmentManifest[0]?.sourceRef).toBe(sourceRef);
    }
    expect(() =>
      schema("BidAssemblyManifestSchema").parse(
        bidManifest({
          attachmentManifest: [
            attachment(1, {
              sourceRef: "第三章/2.1",
              fetchUrl: "https://example.invalid/private.pdf",
            }),
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects submission flags for attachments that are not attached", () => {
    for (const descriptor of [
      attachment(1, { includedInSubmission: false }),
      unavailableAttachment(2, "missing", false),
      unavailableAttachment(3, "rejected", false),
    ]) {
      expect(
        schema("BidAssemblyManifestSchema").parse(
          bidManifest({ attachmentManifest: [descriptor] }),
        ),
      ).toBeDefined();
    }
    expect(() =>
      schema("BidAssemblyManifestSchema").parse(
        bidManifest({
          attachmentManifest: [unavailableAttachment(1, "missing", true)],
        }),
      ),
    ).toThrow();
  });

  it("cannot bypass included-attachment limits by poisoning Array.prototype", () => {
    const originalForEach = Reflect.getOwnPropertyDescriptor(Array.prototype, "forEach");
    const attachments = Array.from({ length: 41 }, (_, index) => attachment(index));
    const hostileAttachments = new Proxy(attachments, {
      getPrototypeOf(target) {
        Object.defineProperty(Array.prototype, "forEach", {
          configurable: true,
          value: () => undefined,
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });
    let accepted = false;
    try {
      schema("BidAssemblyManifestSchema").parse(
        bidManifest({ attachmentManifest: hostileAttachments }),
      );
      accepted = true;
    } catch {
      accepted = false;
    } finally {
      if (originalForEach) Object.defineProperty(Array.prototype, "forEach", originalForEach);
    }
    expect(accepted).toBe(false);
  });

  it("fails closed on unknown keys, accessors and cyclic hostile input", () => {
    const unknown = bidManifest({ fallbackTemplateId: BID_TEMPLATE_ID });
    expect(() => schema("BidAssemblyManifestSchema").parse(unknown)).toThrow();

    let getterCalls = 0;
    const hostile = bidManifest();
    Object.defineProperty(hostile.body, "pageCount", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    expect(() => schema("BidAssemblyManifestSchema").parse(hostile)).toThrow();
    expect(getterCalls).toBe(0);

    const cyclic = bidManifest() as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(() => schema("BidAssemblyManifestSchema").parse(cyclic)).toThrow();
  });
});

describe("API registration contracts", () => {
  it("rejects unknown registration fields and weak acknowledgements", () => {
    const valid = {
      username: "trade_user",
      password: "correct-horse-battery-staple",
      acknowledgements: { noPasswordRecovery: true },
    };
    expect(schema("RegisterRequestSchema").parse(valid)).toBeDefined();
    expect(() =>
      schema("RegisterRequestSchema").parse({ ...valid, email: "private@example.com" }),
    ).toThrow();
    expect(() =>
      schema("RegisterRequestSchema").parse({
        ...valid,
        acknowledgements: { noPasswordRecovery: false },
      }),
    ).toThrow();
  });

  it("locks capability responses to the exact canonical matrix", () => {
    const capabilities = api.CAPABILITIES as readonly Record<string, unknown>[];
    expect(schema("CapabilitiesResponseSchema").parse({ capabilities })).toBeDefined();

    const unknown = capabilities.map((capability) => ({ ...capability }));
    unknown[0] = { ...unknown[0], id: "attacker.capability" };
    for (const invalid of [
      Array.from({ length: 16 }, () => capabilities[0]),
      [...capabilities].reverse(),
      unknown,
    ]) {
      expect(() => schema("CapabilitiesResponseSchema").parse({ capabilities: invalid })).toThrow();
    }

    const undefinedLimit = capabilities.map((capability) => ({ ...capability }));
    undefinedLimit[0] = {
      ...undefinedLimit[0],
      limits: { ...(undefinedLimit[0]?.limits as object), maxPages: undefined },
    };
    expect(() =>
      schema("CapabilitiesResponseSchema").parse({ capabilities: undefinedLimit }),
    ).toThrow();

    const originalToJson = Reflect.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    const poisoned = capabilities.map((capability) => ({ ...capability }));
    poisoned[0] = { ...poisoned[0], inputFormats: ["pdf"], caveatCodes: ["WRONG"] };
    let accepted = false;
    try {
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: () => [],
        writable: true,
      });
      schema("CapabilitiesResponseSchema").parse({ capabilities: poisoned });
      accepted = true;
    } catch {
      accepted = false;
    } finally {
      if (originalToJson) Object.defineProperty(Array.prototype, "toJSON", originalToJson);
      else Reflect.deleteProperty(Array.prototype, "toJSON");
    }
    expect(accepted).toBe(false);
  });

  it("keeps every API response envelope strict, frozen and null-prototype", () => {
    const now = new Date().toISOString();
    const validJob = {
      id: crypto.randomUUID(),
      operation: "office.to.pdf",
      status: "queued",
      quality: "B",
      createdAt: now,
      expiresAt: now,
    };
    const cases = [
      {
        name: "RegistrationResponseSchema",
        valid: {
          user: { id: crypto.randomUUID(), username: "trade_user" },
          recoveryAvailable: false,
        },
        nested: {
          user: { id: crypto.randomUUID(), username: "trade_user", email: "private@example.com" },
          recoveryAvailable: false,
        },
      },
      {
        name: "ApiErrorResponseSchema",
        valid: { error: { code: "INVALID_REQUEST", retryable: false } },
        nested: { error: { code: "INVALID_REQUEST", retryable: false, detail: "private" } },
      },
      {
        name: "CapabilitiesResponseSchema",
        valid: { capabilities: api.CAPABILITIES },
        nested: {
          capabilities: (api.CAPABILITIES as readonly Record<string, unknown>[]).map(
            (item, index) => (index === 0 ? { ...item, private: true } : item),
          ),
        },
      },
      {
        name: "JobResponseSchema",
        valid: { job: validJob },
        nested: { job: { ...validJob, sourceFilename: "private.docx" } },
      },
    ] as const;

    for (const item of cases) {
      const parsed = schema(item.name).parse(item.valid) as Record<string, unknown>;
      expect(Object.getPrototypeOf(parsed), item.name).toBeNull();
      expect(Object.isFrozen(parsed), item.name).toBe(true);
      expect(
        Object.values(parsed).every((value) => Object.isFrozen(value)),
        item.name,
      ).toBe(true);
      expect(() => schema(item.name).parse({ ...item.valid, extra: true }), item.name).toThrow();
      expect(() => schema(item.name).parse(item.nested), item.name).toThrow();
    }
  });

  it("enforces status/result/error and progress invariants", () => {
    const now = new Date().toISOString();
    const base = {
      id: crypto.randomUUID(),
      operation: "office.to.pdf",
      quality: "B",
      createdAt: now,
      expiresAt: now,
    };
    const result = { ready: true, mediaType: "application/pdf", sizeBytes: 10 };
    const error = { code: "CONVERSION_FAILED", retryable: false };
    for (const valid of [
      { ...base, status: "queued" },
      { ...base, status: "running", progress: { phase: "converting", completed: 1, total: 1 } },
      { ...base, status: "succeeded", result },
      { ...base, status: "failed", error },
    ]) {
      expect(schema("JobStatusSchema").parse(valid)).toBeDefined();
    }
    for (const invalid of [
      { ...base, status: "succeeded" },
      { ...base, status: "failed" },
      { ...base, status: "queued", result },
      { ...base, status: "queued", error },
      { ...base, status: "running", progress: { phase: "converting", completed: 2, total: 1 } },
      { ...base, status: "queued", progress: { phase: "finalizing", completed: 0, total: 1 } },
      { ...base, operation: "image.convert.hq", status: "queued" },
      {
        ...base,
        status: "succeeded",
        result: { ready: true, mediaType: "image/png", sizeBytes: 10 },
      },
    ]) {
      expect(() => schema("JobStatusSchema").parse(invalid)).toThrow();
    }
  });
});
