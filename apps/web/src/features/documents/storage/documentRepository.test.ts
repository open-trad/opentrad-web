import type { v2 } from "@opentrad/document-core";
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "./documentRepository";

function pdfBlob(): Blob {
  return new Blob([new TextEncoder().encode("%PDF-1.7\n%%EOF")], {
    type: "application/pdf",
  });
}

function attachment(status: "missing" | "attached" | "rejected" = "attached") {
  const localBlobKey = "quotation.service.project.v1@1.0.0:doc-1#spec";
  return {
    id: "spec",
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
  overrides: { modelDocumentId?: string } = {},
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
            language: "zh-CN",
            title: { zhCN: "服务项目报价单" },
            pageDefaults: {
              size: "A4",
              orientation: "portrait",
              marginsMm: { top: 20, right: 18, bottom: 20, left: 18 },
            },
            sections: [],
            watermarks: [],
            disclaimers: ["quotation-non-advice"],
            attachmentManifest: draft.attachments ?? [],
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
  });

  it("derives a version-keyed identity without invoking getters", () => {
    expect(documentStorageKey(envelope())).toBe("quotation.service.project.v1@1.0.0:doc-1");
    expect(() =>
      documentStorageKey(Object.create({ template: envelope().template }) as never),
    ).toThrow();
  });
});
