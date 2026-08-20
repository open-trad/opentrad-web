import { v2 } from "@opentrad/document-core";
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bidGovernmentGoodsJson from "../../../../../../packages/document-core/tests/fixtures/v2/bid-government-goods.json?raw";
import {
  ATTACHMENTS_STORE,
  DOCUMENTS_V2_STORE,
  META_STORE,
  QUOTATION_DATABASE_VERSION,
} from "../../quotation/storage/repository";
import {
  createDocumentRepository,
  type DocumentTemplateRegistry,
  documentStorageKey,
  validateDocumentEnvelope,
} from "./documentRepository";

function realBidEnvelope(
  updateDraft: (draft: Record<string, unknown>) => Record<string, unknown> = (draft) => draft,
): v2.ProjectEnvelopeV2 {
  const draft = updateDraft(JSON.parse(bidGovernmentGoodsJson) as Record<string, unknown>);
  const attachments = draft.attachments as v2.AttachmentRefV1[];
  const key = `${draft.templateId as string}@${draft.templateVersion as string}:${draft.id as string}`;
  return {
    formatVersion: "2.0.0",
    template: {
      id: "bid.government.goods.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft: draft as v2.ProjectDraftV2,
    presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
    attachmentManifest: attachments.map((entry) => ({
      ...entry,
      ...(entry.status === "attached" ? { localBlobKey: `${key}#${entry.id}` } : {}),
    })),
  };
}

function pdfBlob(): Blob {
  return new Blob([new TextEncoder().encode("%PDF-1.7\n%%EOF")], {
    type: "application/pdf",
  });
}

function attachment(status: "missing" | "attached" | "rejected" = "attached", id = "spec") {
  const localBlobKey = `quotation.service.project.v1@1.0.0:doc-1#${id}`;
  return {
    id,
    category: "technical" as const,
    displayName: "技术规格.pdf",
    mediaType: "application/pdf" as const,
    pageCount: 2,
    required: true,
    status,
    includedInSubmission: status === "attached",
    ...(status === "attached" ? { localBlobKey } : {}),
  };
}

function envelope(manifest: readonly v2.AttachmentRefV1[] = []): v2.ProjectEnvelopeV2 {
  return {
    formatVersion: "2.0.0",
    template: {
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft: {
      id: "doc-1",
      templateId: "quotation.service.project.v1",
      templateVersion: "1.0.0",
      title: "服务项目",
      attachments: manifest.map(({ localBlobKey: _localBlobKey, ...entry }) => entry),
    },
    presentation: { layoutStyleId: "modern-business.v1", languageView: "zh-CN" },
    attachmentManifest: manifest,
  };
}

function registryFor(
  _manifest: readonly v2.AttachmentRefV1[] = [],
  overrides: { modelDocumentId?: string; modelLanguage?: v2.DocumentLanguageV2 } = {},
): DocumentTemplateRegistry {
  return {
    get(templateId, templateVersion) {
      if (templateId !== "quotation.service.project.v1" || templateVersion !== "1.0.0") {
        throw new Error("不支持的模板版本");
      }
      return {
        definition: {
          id: "quotation.service.project.v1",
          version: "1.0.0",
          basisDate: "2026-08-19",
        },
        parseDraft(input) {
          return structuredClone(input);
        },
        compile(input) {
          const draft = input as v2.ProjectDraftV2 & {
            readonly attachments?: readonly v2.AttachmentRefV1[];
          };
          return {
            schemaVersion: "2.0.0",
            documentId: overrides.modelDocumentId ?? draft.id,
            template: {
              id: "quotation.service.project.v1",
              version: "1.0.0",
              basisDate: "2026-08-19",
            },
            documentKind: "quotation",
            language: overrides.modelLanguage ?? "zh-CN",
            title: { zhCN: "服务项目报价单" },
            pageDefaults: {
              size: "A4",
              orientation: "portrait",
              marginsMm: { top: 20, right: 18, bottom: 20, left: 18 },
            },
            sections: [],
            watermarks: [],
            disclaimers: ["quotation-non-advice"],
            attachmentManifest: (draft.attachments ?? [])
              .filter((entry) => entry.includedInSubmission)
              .map(({ localBlobKey: _localBlobKey, sourceRef, ...entry }) => ({
                ...entry,
                ...(sourceRef &&
                !/^[a-z][a-z0-9+.-]*:/iu.test(sourceRef.trim()) &&
                !/^(?:\/|\\|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/iu.test(sourceRef.trim()) &&
                !sourceRef.includes("\\")
                  ? { sourceRef }
                  : {}),
              })),
          };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("V2 document repository", () => {
  it("commits the document, attachment and current pointer atomically with a global blob key", async () => {
    const manifest = [attachment()];
    const repository = createDocumentRepository({
      databaseName: "v2-atomic-save",
      registry: registryFor(manifest),
    });
    const input = envelope(manifest);

    const stored = await repository.commit({
      envelope: input,
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: true,
      failIfExists: true,
      attachmentChanges: [
        { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
      ],
    });

    expect(stored.key).toBe("quotation.service.project.v1@1.0.0:doc-1");
    expect(stored.revision).toBe(1);
    expect(stored.model.attachmentManifest[0]).not.toHaveProperty("localBlobKey");
    expect((await repository.getCurrent())?.key).toBe(stored.key);
    const attachments = await repository.listAttachments(stored.key);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      localBlobKey: `${stored.key}#spec`,
      documentKey: stored.key,
      attachmentId: "spec",
      byteLength: pdfBlob().size,
      pageCount: 2,
    });
    repository.close();
  });

  it("uses optimistic revisions and failIfExists without partial attachment writes", async () => {
    const repository = createDocumentRepository({
      databaseName: "v2-concurrency",
      registry: registryFor(),
    });
    const first = await repository.commit({
      envelope: envelope(),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      failIfExists: true,
      attachmentChanges: [],
    });
    await expect(
      repository.commit({
        envelope: envelope(),
        savedAt: "2026-08-20T08:01:00.000Z",
        makeCurrent: false,
        failIfExists: true,
        attachmentChanges: [],
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_EXISTS" });
    await expect(
      repository.commit({
        envelope: envelope(),
        savedAt: "2026-08-20T08:01:00.000Z",
        makeCurrent: false,
        expectedRevision: 0,
        attachmentChanges: [],
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    const second = await repository.commit({
      envelope: envelope(),
      savedAt: "2026-08-20T08:02:00.000Z",
      makeCurrent: false,
      expectedRevision: first.revision,
      attachmentChanges: [],
    });
    expect(second.revision).toBe(2);
    repository.close();
  });

  it("rejects one of two updates that validated the same attachment snapshot", async () => {
    const initialManifest = [attachment("attached", "first"), attachment("attached", "second")];
    const databaseName = "v2-concurrent-attachment-snapshot";
    const firstRepository = createDocumentRepository({
      databaseName,
      registry: registryFor(initialManifest),
    });
    const initial = await firstRepository.commit({
      envelope: envelope(initialManifest),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      attachmentChanges: initialManifest.map((entry) => ({
        type: "put" as const,
        attachmentId: entry.id,
        blob: pdfBlob(),
        pageCountConfirmed: true,
      })),
    });
    const secondRepository = createDocumentRepository({
      databaseName,
      registry: registryFor(initialManifest),
    });
    await secondRepository.get(initial.key);

    const nativeArrayBuffer = NodeBlob.prototype.arrayBuffer;
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(NodeBlob.prototype, "arrayBuffer").mockImplementation(async function (this: NodeBlob) {
      reads += 1;
      if (reads === 2) release();
      await barrier;
      return nativeArrayBuffer.call(this);
    });

    const results = await Promise.allSettled([
      firstRepository.commit({
        envelope: envelope([attachment("attached", "first")]),
        savedAt: "2026-08-20T08:01:00.000Z",
        makeCurrent: false,
        attachmentChanges: [{ type: "remove", attachmentId: "second" }],
      }),
      secondRepository.commit({
        envelope: envelope([attachment("attached", "second")]),
        savedAt: "2026-08-20T08:02:00.000Z",
        makeCurrent: false,
        attachmentChanges: [{ type: "remove", attachmentId: "first" }],
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "DOCUMENT_CONFLICT" }) }),
    ]);
    const stored = await firstRepository.get(initial.key);
    expect(
      (await firstRepository.listAttachments(initial.key)).map((entry) => entry.attachmentId),
    ).toEqual(stored?.envelope.attachmentManifest.map((entry) => entry.id));
    firstRepository.close();
    secondRepository.close();
  });

  it("removes attachments and deletes document, pointer and blobs in single transactions", async () => {
    const attached = [attachment()];
    const repository = createDocumentRepository({
      databaseName: "v2-atomic-delete",
      registry: registryFor(attached),
    });
    const first = await repository.commit({
      envelope: envelope(attached),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: true,
      attachmentChanges: [
        { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
      ],
    });
    repository.close();

    const missing = [attachment("missing")];
    const reopened = createDocumentRepository({
      databaseName: "v2-atomic-delete",
      registry: registryFor(missing),
    });
    const second = await reopened.commit({
      envelope: envelope(missing),
      savedAt: "2026-08-20T08:01:00.000Z",
      makeCurrent: true,
      expectedRevision: first.revision,
      attachmentChanges: [{ type: "remove", attachmentId: "spec" }],
    });
    expect(second.revision).toBe(2);
    expect(await reopened.listAttachments(second.key)).toEqual([]);
    await reopened.delete(second.key, { expectedRevision: second.revision });
    expect(await reopened.get(second.key)).toBeNull();
    expect(await reopened.getCurrent()).toBeNull();
    reopened.close();
  });

  it("maps quota failure and aborts document, blob and pointer writes", async () => {
    const manifest = [attachment()];
    const databaseName = "v2-quota-abort";
    const repository = createDocumentRepository({
      databaseName,
      registry: registryFor(manifest),
    });
    await repository.list();
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if ((value as { localBlobKey?: string }).localBlobKey) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    });

    await expect(
      repository.commit({
        envelope: envelope(manifest),
        savedAt: "2026-08-20T08:00:00.000Z",
        makeCurrent: true,
        attachmentChanges: [
          { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
        ],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_QUOTA" });
    expect(await repository.list()).toEqual([]);
    expect(await repository.getCurrent()).toBeNull();
    repository.close();
  });

  it("reads and validates blobs before opening the write transaction", async () => {
    const manifest = [attachment()];
    const repository = createDocumentRepository({
      databaseName: "v2-read-before-write",
      registry: registryFor(manifest),
    });
    await repository.list();
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");
    const blob = pdfBlob();
    Object.defineProperty(blob, "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("read failed")),
    });

    await expect(
      repository.commit({
        envelope: envelope(manifest),
        savedAt: "2026-08-20T08:00:00.000Z",
        makeCurrent: true,
        attachmentChanges: [{ type: "put", attachmentId: "spec", blob, pageCountConfirmed: true }],
      }),
    ).rejects.toThrow("read failed");
    expect(transaction.mock.calls.some((call) => call[1] === "readwrite")).toBe(false);
    repository.close();
  });

  it("cleans a stale current pointer and rejects draft/model/manifest identity drift", async () => {
    const databaseName = "v2-stale-pointer";
    const repository = createDocumentRepository({ databaseName, registry: registryFor() });
    const stored = await repository.commit({
      envelope: envelope(),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: true,
      attachmentChanges: [],
    });
    repository.close();
    const raw = await openDB(databaseName, QUOTATION_DATABASE_VERSION);
    await raw.delete(DOCUMENTS_V2_STORE, stored.key);
    raw.close();

    const reopened = createDocumentRepository({ databaseName, registry: registryFor() });
    expect(await reopened.getCurrent()).toBeNull();
    reopened.close();
    const checked = await openDB(databaseName, QUOTATION_DATABASE_VERSION);
    expect(await checked.get(META_STORE, "current-document-v2")).toBeUndefined();
    expect(await checked.count(ATTACHMENTS_STORE)).toBe(0);
    checked.close();

    const invalid = createDocumentRepository({
      databaseName: "v2-invalid-model",
      registry: registryFor([], { modelDocumentId: "other-document" }),
    });
    await expect(
      invalid.commit({
        envelope: envelope(),
        savedAt: "2026-08-20T08:00:00.000Z",
        makeCurrent: false,
        attachmentChanges: [],
      }),
    ).rejects.toThrow("文档模型身份不一致");
    invalid.close();

    const wrongLanguage = createDocumentRepository({
      databaseName: "v2-invalid-language",
      registry: registryFor([], { modelLanguage: "en-US" }),
    });
    await expect(
      wrongLanguage.commit({
        envelope: envelope(),
        savedAt: "2026-08-20T08:00:00.000Z",
        makeCurrent: false,
        attachmentChanges: [],
      }),
    ).rejects.toThrow("文档模型身份不一致");
    wrongLanguage.close();
  });

  it("queries and deletes a document's attachments inside one readwrite transaction", async () => {
    const databaseName = "v2-single-delete-transaction";
    const repository = createDocumentRepository({ databaseName, registry: registryFor() });
    const stored = await repository.commit({
      envelope: envelope(),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      attachmentChanges: [],
    });
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");

    await repository.delete(stored.key, { expectedRevision: stored.revision });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0]).toEqual([
      DOCUMENTS_V2_STORE,
      ATTACHMENTS_STORE,
      META_STORE,
    ]);
    expect(transaction.mock.calls[0]?.[1]).toBe("readwrite");
    repository.close();
  });

  it("lists a validated document and its attachments from one readonly snapshot", async () => {
    const manifest = [attachment()];
    const repository = createDocumentRepository({
      databaseName: "v2-single-list-transaction",
      registry: registryFor(manifest),
    });
    const stored = await repository.commit({
      envelope: envelope(manifest),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      attachmentChanges: [
        { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
      ],
    });
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");

    expect(await repository.listAttachments(stored.key)).toHaveLength(1);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0]).toEqual([DOCUMENTS_V2_STORE, ATTACHMENTS_STORE]);
    expect(transaction.mock.calls[0]?.[1]).toBe("readonly");
    repository.close();
  });

  it("derives a version-keyed identity without invoking getters", () => {
    expect(documentStorageKey(envelope())).toBe("quotation.service.project.v1@1.0.0:doc-1");
    expect(() =>
      documentStorageKey(Object.create({ template: envelope().template }) as never),
    ).toThrow();
  });

  it("stores source-only attachment blobs while comparing the model to the included portable subset", async () => {
    const included = attachment();
    const sourceOnly = {
      ...attachment(),
      id: "source-only",
      displayName: "采购方招标文件.pdf",
      sourceRef: "file:///Users/example/private-source.pdf",
      includedInSubmission: false,
      localBlobKey: "quotation.service.project.v1@1.0.0:doc-1#source-only",
    };
    const manifest = [included, sourceOnly];
    const repository = createDocumentRepository({
      databaseName: "v2-source-only-attachment",
      registry: registryFor(manifest),
    });

    const stored = await repository.commit({
      envelope: envelope(manifest),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      attachmentChanges: [
        { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
        {
          type: "put",
          attachmentId: "source-only",
          blob: pdfBlob(),
          pageCountConfirmed: true,
        },
      ],
    });

    expect(stored.envelope.attachmentManifest).toHaveLength(2);
    expect(stored.model.attachmentManifest.map((entry) => entry.id)).toEqual(["spec"]);
    expect(await repository.listAttachments(stored.key)).toHaveLength(2);
    repository.close();
  });

  it("strips an included local URI reference before comparing the public model", async () => {
    const included = {
      ...attachment(),
      sourceRef: "https://example.invalid/private-source.pdf",
    };
    const repository = createDocumentRepository({
      databaseName: "v2-public-local-uri",
      registry: registryFor([included]),
    });

    const stored = await repository.commit({
      envelope: envelope([included]),
      savedAt: "2026-08-20T08:00:00.000Z",
      makeCurrent: false,
      attachmentChanges: [
        { type: "put", attachmentId: "spec", blob: pdfBlob(), pageCountConfirmed: true },
      ],
    });

    expect(stored.envelope.attachmentManifest[0]).toHaveProperty("sourceRef");
    expect(stored.model.attachmentManifest[0]).not.toHaveProperty("sourceRef");
    repository.close();
  });

  it("compares a real bid public manifest semantically instead of by object key order", () => {
    const envelope = realBidEnvelope((draft) => ({
      ...draft,
      attachments: (draft.attachments as v2.AttachmentRefV1[]).map((entry) =>
        entry.id === "proof-license"
          ? { ...entry, sourceRef: "用户确认的附件证据编号 A-1" }
          : entry,
      ),
    }));

    const validated = validateDocumentEnvelope(envelope, v2.V2_TEMPLATE_REGISTRY);

    expect(
      validated.model.attachmentManifest.find((entry) => entry.id === "proof-license")?.sourceRef,
    ).toBe("用户确认的附件证据编号 A-1");
    expect(validated.model.attachmentManifest.map((entry) => entry.id)).not.toContain(
      "source-main",
    );
  });
});
