import { v2 } from "@opentrad/document-core";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { LocalDataError, normalizeLocalDataError } from "../../quotation/storage/errors";
import {
  ATTACHMENTS_STORE,
  createQuotationRepository,
  DOCUMENTS_V2_STORE,
  META_STORE,
  QUOTATION_DATABASE_NAME,
  QUOTATION_DATABASE_VERSION,
} from "../../quotation/storage/repository";
import {
  prepareAttachmentPut,
  type StoredAttachmentV2,
  validateAttachmentInventory,
} from "./attachmentValidation";

const CURRENT_DOCUMENT_V2_KEY = "current-document-v2";

export interface DocumentTemplateRegistry {
  readonly get: (
    templateId: string,
    templateVersion: string,
  ) => {
    readonly definition: {
      readonly id: string;
      readonly version: string;
      readonly basisDate: string;
    };
    readonly parseDraft: (input: unknown) => unknown;
    readonly compile: (draft: unknown) => unknown;
  };
}

export interface StoredDocumentV2 {
  readonly key: string;
  readonly documentId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly templateKey: string;
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly model: v2.DocumentModelV2;
  readonly revision: number;
  readonly savedAt: string;
}

interface DocumentDatabase extends DBSchema {
  documentsV2: {
    key: string;
    value: StoredDocumentV2;
    indexes: {
      "by-saved-at": string;
      "by-template": string;
      "by-document-id": string;
    };
  };
  attachments: {
    key: string;
    value: StoredAttachmentV2;
    indexes: { "by-document-key": string };
  };
  meta: {
    key: string;
    value: { key: string; value: string | null };
  };
}

export class DocumentRepositoryError extends Error {
  readonly code: "DOCUMENT_CONFLICT" | "DOCUMENT_EXISTS" | "DOCUMENT_CORRUPT";

  constructor(code: "DOCUMENT_CONFLICT" | "DOCUMENT_EXISTS" | "DOCUMENT_CORRUPT") {
    super(
      code === "DOCUMENT_CONFLICT"
        ? "文档已在其他页面更新，请重新载入"
        : code === "DOCUMENT_EXISTS"
          ? "文档已存在"
          : "本地 V2 文档数据已损坏",
    );
    this.name = "DocumentRepositoryError";
    this.code = code;
  }
}

function isoDateTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  }
  return value;
}

function ownData(object: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !("value" in descriptor))
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  return descriptor.value;
}

export function documentStorageKey(input: v2.ProjectEnvelopeV2): string {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const template = ownData(input, "template");
    const draft = ownData(input, "draft");
    if (
      template === null ||
      typeof template !== "object" ||
      draft === null ||
      typeof draft !== "object"
    ) {
      throw new Error();
    }
    const templateId = ownData(template, "id");
    const templateVersion = ownData(template, "version");
    const documentId = ownData(draft, "id");
    if (
      typeof templateId !== "string" ||
      typeof templateVersion !== "string" ||
      typeof documentId !== "string"
    ) {
      throw new Error();
    }
    return `${templateId}@${templateVersion}:${documentId}`;
  } catch {
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  }
}

function containsLocalBlobKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor))
      throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
    if (key === "localBlobKey") return true;
    if (containsLocalBlobKey(descriptor.value)) return true;
  }
  return false;
}

function isLocalOnlySourceRef(sourceRef: string): boolean {
  const value = sourceRef.trim();
  return (
    /^[a-z][a-z0-9+.-]*:/iu.test(value) ||
    /^(?:\/|\\|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/iu.test(value) ||
    value.includes("\\")
  );
}

function publicAttachment(attachment: v2.AttachmentRefV1): v2.AttachmentRefV1 {
  const { localBlobKey: _localBlobKey, sourceRef, ...portable } = attachment;
  return {
    ...portable,
    ...(sourceRef && !isLocalOnlySourceRef(sourceRef) ? { sourceRef } : {}),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateDocumentEnvelope(
  input: unknown,
  registry: DocumentTemplateRegistry,
): { envelope: v2.ProjectEnvelopeV2; model: v2.DocumentModelV2 } {
  let envelope: v2.ProjectEnvelopeV2;
  try {
    envelope = v2.ProjectEnvelopeV2Schema.parse(input);
    if (containsLocalBlobKey(envelope.draft)) {
      throw new Error("文档草稿不得包含本地 Blob 引用");
    }
    const registration = registry.get(envelope.template.id, envelope.template.version);
    if (
      registration.definition.id !== envelope.template.id ||
      registration.definition.version !== envelope.template.version ||
      registration.definition.basisDate !== envelope.template.basisDate
    ) {
      throw new Error("模板身份不一致");
    }
    const parsedDraft = registration.parseDraft(envelope.draft);
    envelope = v2.ProjectEnvelopeV2Schema.parse({ ...envelope, draft: parsedDraft });
    const model = v2.DocumentModelV2Schema.parse(registration.compile(parsedDraft));
    if (
      model.documentId !== envelope.draft.id ||
      model.template.id !== envelope.template.id ||
      model.template.version !== envelope.template.version ||
      model.template.basisDate !== envelope.template.basisDate ||
      model.language !== envelope.presentation.languageView
    ) {
      throw new Error("文档模型身份不一致");
    }
    if (containsLocalBlobKey(model)) throw new Error("文档模型不得包含本地 Blob 引用");
    const publicManifest = envelope.attachmentManifest
      .filter((attachment) => attachment.includedInSubmission)
      .map(publicAttachment);
    if (!sameJson(model.attachmentManifest, publicManifest)) {
      throw new Error("附件清单与文档模型不一致");
    }
    return { envelope, model };
  } catch (error) {
    if (error instanceof Error && !error.message.includes("[") && error.message.length < 80) {
      throw error;
    }
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  }
}

function parseStoredDocument(input: unknown, registry: DocumentTemplateRegistry): StoredDocumentV2 {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const envelopeAndModel = validateDocumentEnvelope(ownData(input, "envelope"), registry);
    const key = documentStorageKey(envelopeAndModel.envelope);
    const storedModel = v2.DocumentModelV2Schema.parse(ownData(input, "model"));
    const revision = ownData(input, "revision");
    if (
      ownData(input, "key") !== key ||
      ownData(input, "documentId") !== envelopeAndModel.envelope.draft.id ||
      ownData(input, "templateId") !== envelopeAndModel.envelope.template.id ||
      ownData(input, "templateVersion") !== envelopeAndModel.envelope.template.version ||
      ownData(input, "templateKey") !==
        `${envelopeAndModel.envelope.template.id}@${envelopeAndModel.envelope.template.version}` ||
      !Number.isSafeInteger(revision) ||
      (revision as number) < 1 ||
      !sameJson(storedModel, envelopeAndModel.model)
    ) {
      throw new Error();
    }
    return {
      key,
      documentId: envelopeAndModel.envelope.draft.id,
      templateId: envelopeAndModel.envelope.template.id,
      templateVersion: envelopeAndModel.envelope.template.version,
      templateKey: `${envelopeAndModel.envelope.template.id}@${envelopeAndModel.envelope.template.version}`,
      envelope: envelopeAndModel.envelope,
      model: storedModel,
      revision: revision as number,
      savedAt: isoDateTime(ownData(input, "savedAt")),
    };
  } catch (error) {
    if (error instanceof DocumentRepositoryError) throw error;
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  }
}

export type AttachmentChange =
  | {
      readonly type: "put";
      readonly attachmentId: string;
      readonly blob: Blob;
      readonly pageCountConfirmed?: boolean;
    }
  | { readonly type: "remove"; readonly attachmentId: string };

export interface DocumentRepositoryV2 {
  commit(input: {
    readonly envelope: unknown;
    readonly savedAt: string;
    readonly makeCurrent: boolean;
    readonly expectedRevision?: number;
    readonly attachmentChanges: readonly AttachmentChange[];
    readonly failIfExists?: boolean;
  }): Promise<StoredDocumentV2>;
  get(key: string): Promise<StoredDocumentV2 | null>;
  getCurrent(): Promise<StoredDocumentV2 | null>;
  list(): Promise<StoredDocumentV2[]>;
  listAttachments(documentKey: string): Promise<StoredAttachmentV2[]>;
  delete(key: string, options?: { readonly expectedRevision?: number }): Promise<void>;
  close(): void;
}

function safeKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new DocumentRepositoryError("DOCUMENT_CORRUPT");
  }
  return value;
}

export function createDocumentRepository(options: {
  readonly databaseName?: string;
  readonly registry: DocumentTemplateRegistry;
}): DocumentRepositoryV2 {
  const databaseName = options.databaseName ?? QUOTATION_DATABASE_NAME;
  let database: IDBPDatabase<DocumentDatabase> | undefined;
  let opening: Promise<IDBPDatabase<DocumentDatabase>> | undefined;

  async function getDatabase(): Promise<IDBPDatabase<DocumentDatabase>> {
    if (database) return database;
    if (!opening) {
      opening = (async () => {
        const bootstrap = createQuotationRepository({ databaseName });
        try {
          await bootstrap.listDrafts();
        } finally {
          bootstrap.close();
        }
        const opened = await openDB<DocumentDatabase>(databaseName, QUOTATION_DATABASE_VERSION);
        database = opened;
        return opened;
      })().catch((error: unknown) => {
        opening = undefined;
        throw normalizeLocalDataError(error);
      });
    }
    return opening;
  }

  async function run<T>(operation: (opened: IDBPDatabase<DocumentDatabase>) => Promise<T>) {
    try {
      return await operation(await getDatabase());
    } catch (error) {
      if (error instanceof DocumentRepositoryError || error instanceof LocalDataError) throw error;
      throw normalizeLocalDataError(error);
    }
  }

  async function abortAndReject(
    transaction: { abort(): void; done: Promise<unknown> },
    error: unknown,
  ): Promise<never> {
    try {
      transaction.abort();
    } catch {
      // The request may already have aborted the transaction.
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }

  return {
    async commit(input) {
      const savedAt = isoDateTime(input.savedAt);
      const { envelope, model } = validateDocumentEnvelope(input.envelope, options.registry);
      const key = documentStorageKey(envelope);
      const descriptors = new Map(envelope.attachmentManifest.map((entry) => [entry.id, entry]));
      const snapshot = await run(async (opened) => {
        const transaction = opened.transaction([DOCUMENTS_V2_STORE, ATTACHMENTS_STORE], "readonly");
        const [previousRaw, existing] = await Promise.all([
          transaction.objectStore(DOCUMENTS_V2_STORE).get(key),
          transaction.objectStore(ATTACHMENTS_STORE).index("by-document-key").getAll(key),
        ]);
        await transaction.done;
        return {
          existing,
          previous: previousRaw ? parseStoredDocument(previousRaw, options.registry) : null,
        };
      });
      if (input.failIfExists && snapshot.previous) {
        throw new DocumentRepositoryError("DOCUMENT_EXISTS");
      }
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== (snapshot.previous?.revision ?? 0)
      ) {
        throw new DocumentRepositoryError("DOCUMENT_CONFLICT");
      }
      const existing = snapshot.existing;
      const finalRecords = new Map(existing.map((entry) => [entry.attachmentId, entry]));
      const changedIds = new Set<string>();
      for (const change of input.attachmentChanges) {
        if (changedIds.has(change.attachmentId)) throw new Error("附件变更标识重复");
        changedIds.add(change.attachmentId);
        if (change.type === "remove") {
          finalRecords.delete(change.attachmentId);
          continue;
        }
        const descriptor = descriptors.get(change.attachmentId);
        if (!descriptor) throw new Error("附件变更未在清单中声明");
        finalRecords.set(
          change.attachmentId,
          await prepareAttachmentPut({
            documentKey: key,
            descriptor,
            blob: change.blob,
            pageCountConfirmed: change.pageCountConfirmed,
            savedAt,
          }),
        );
      }
      await validateAttachmentInventory({
        documentKey: key,
        documentKind: model.documentKind,
        descriptors: envelope.attachmentManifest,
        records: [...finalRecords.values()],
      });

      return run(async (writeDatabase) => {
        const transaction = writeDatabase.transaction(
          [DOCUMENTS_V2_STORE, ATTACHMENTS_STORE, META_STORE],
          "readwrite",
        );
        try {
          const documents = transaction.objectStore(DOCUMENTS_V2_STORE);
          const previousRaw = await documents.get(key);
          const previous = previousRaw ? parseStoredDocument(previousRaw, options.registry) : null;
          if (input.failIfExists && previous) {
            throw new DocumentRepositoryError("DOCUMENT_EXISTS");
          }
          if (
            input.expectedRevision !== undefined &&
            input.expectedRevision !== (previous?.revision ?? 0)
          ) {
            throw new DocumentRepositoryError("DOCUMENT_CONFLICT");
          }
          if ((previous?.revision ?? 0) !== (snapshot.previous?.revision ?? 0)) {
            throw new DocumentRepositoryError("DOCUMENT_CONFLICT");
          }
          const record: StoredDocumentV2 = {
            key,
            documentId: envelope.draft.id,
            templateId: envelope.template.id,
            templateVersion: envelope.template.version,
            templateKey: `${envelope.template.id}@${envelope.template.version}`,
            envelope,
            model,
            revision: (previous?.revision ?? 0) + 1,
            savedAt,
          };
          await documents.put(record);
          for (const change of input.attachmentChanges) {
            const localBlobKey = `${key}#${change.attachmentId}`;
            if (change.type === "remove") {
              await transaction.objectStore(ATTACHMENTS_STORE).delete(localBlobKey);
            } else {
              const attachment = finalRecords.get(change.attachmentId);
              if (!attachment) throw new Error("附件变更缺少已校验 Blob");
              await transaction.objectStore(ATTACHMENTS_STORE).put(attachment);
            }
          }
          if (input.makeCurrent) {
            await transaction
              .objectStore(META_STORE)
              .put({ key: CURRENT_DOCUMENT_V2_KEY, value: key });
          }
          await transaction.done;
          return parseStoredDocument(record, options.registry);
        } catch (error) {
          return abortAndReject(transaction, error);
        }
      });
    },

    async get(key) {
      const safe = safeKey(key);
      return run(async (opened) => {
        const record = await opened.get(DOCUMENTS_V2_STORE, safe);
        return record ? parseStoredDocument(record, options.registry) : null;
      });
    },

    async getCurrent() {
      return run(async (opened) => {
        const transaction = opened.transaction([META_STORE, DOCUMENTS_V2_STORE], "readwrite");
        const meta = transaction.objectStore(META_STORE);
        try {
          const pointer = await meta.get(CURRENT_DOCUMENT_V2_KEY);
          if (!pointer || pointer.value === null) {
            await transaction.done;
            return null;
          }
          const key = safeKey(pointer.value);
          const record = await transaction.objectStore(DOCUMENTS_V2_STORE).get(key);
          if (record) {
            const parsed = parseStoredDocument(record, options.registry);
            await transaction.done;
            return parsed;
          }
          await Promise.all([meta.delete(CURRENT_DOCUMENT_V2_KEY), transaction.done]);
          return null;
        } catch (error) {
          return abortAndReject(transaction, error);
        }
      });
    },

    async list() {
      return run(async (opened) => {
        const records = (await opened.getAll(DOCUMENTS_V2_STORE)).map((entry) =>
          parseStoredDocument(entry, options.registry),
        );
        return records.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      });
    },

    async listAttachments(documentKey) {
      const key = safeKey(documentKey);
      return run(async (opened) => {
        const transaction = opened.transaction([DOCUMENTS_V2_STORE, ATTACHMENTS_STORE], "readonly");
        const [documentRaw, records] = await Promise.all([
          transaction.objectStore(DOCUMENTS_V2_STORE).get(key),
          transaction.objectStore(ATTACHMENTS_STORE).index("by-document-key").getAll(key),
        ]);
        await transaction.done;
        const document = documentRaw ? parseStoredDocument(documentRaw, options.registry) : null;
        await validateAttachmentInventory({
          documentKey: key,
          documentKind: document?.model.documentKind ?? "quotation",
          descriptors: document?.envelope.attachmentManifest ?? [],
          records,
        });
        return records.sort((left, right) => left.attachmentId.localeCompare(right.attachmentId));
      });
    },

    async delete(key, deleteOptions = {}) {
      const safe = safeKey(key);
      await run(async (opened) => {
        const transaction = opened.transaction(
          [DOCUMENTS_V2_STORE, ATTACHMENTS_STORE, META_STORE],
          "readwrite",
        );
        try {
          const documents = transaction.objectStore(DOCUMENTS_V2_STORE);
          const attachments = transaction.objectStore(ATTACHMENTS_STORE);
          const existingAttachments = await attachments.index("by-document-key").getAll(safe);
          const existingRaw = await documents.get(safe);
          const existing = existingRaw ? parseStoredDocument(existingRaw, options.registry) : null;
          if (
            deleteOptions.expectedRevision !== undefined &&
            deleteOptions.expectedRevision !== (existing?.revision ?? 0)
          ) {
            throw new DocumentRepositoryError("DOCUMENT_CONFLICT");
          }
          await documents.delete(safe);
          for (const attachment of existingAttachments) {
            await attachments.delete(attachment.localBlobKey);
          }
          const meta = transaction.objectStore(META_STORE);
          const pointer = await meta.get(CURRENT_DOCUMENT_V2_KEY);
          if (pointer?.value === safe) await meta.delete(CURRENT_DOCUMENT_V2_KEY);
          await transaction.done;
        } catch (error) {
          return abortAndReject(transaction, error);
        }
      });
    },

    close() {
      database?.close();
      database = undefined;
      opening = undefined;
    },
  };
}
