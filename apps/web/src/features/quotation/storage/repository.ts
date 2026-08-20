import {
  type Party,
  PartySchema,
  parseDocumentDraft,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { LocalDataError, normalizeLocalDataError } from "./errors";

export const QUOTATION_DATABASE_NAME = "opentrad-local";
export const QUOTATION_DATABASE_VERSION = 2;
// Opening v2 is an IndexedDB rollback floor: a v1 client receives VersionError.
export const QUOTATION_DATABASE_ROLLBACK_FLOOR = 2;
export const COMPANY_PROFILES_STORE = "companyProfiles";
export const DRAFTS_STORE = "drafts";
export const META_STORE = "meta";
export const DOCUMENTS_V2_STORE = "documentsV2";
export const ATTACHMENTS_STORE = "attachments";
const CURRENT_DRAFT_KEY = "current-draft-id";

export interface CompanyProfile {
  id: string;
  label: string;
  party: Party;
  updatedAt: string;
}

export interface StoredDraft {
  id: string;
  draft: StandardGoodsQuoteDraft;
  revision: number;
  savedAt: string;
}

interface MetaRecord {
  key: typeof CURRENT_DRAFT_KEY;
  value: string | null;
}

interface QuotationDatabase extends DBSchema {
  companyProfiles: {
    key: string;
    value: CompanyProfile;
    indexes: { "by-updated-at": string };
  };
  drafts: {
    key: string;
    value: StoredDraft;
    indexes: { "by-saved-at": string };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
  documentsV2: {
    key: string;
    value: { key: string; templateId: string; savedAt: string };
    indexes: { "by-saved-at": string; "by-template-id": string };
  };
  attachments: {
    key: string;
    value: { localBlobKey: string; documentKey: string };
    indexes: { "by-document-key": string };
  };
}

export type StorageHealthEvent =
  | {
      state: "blocked";
      message: "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试";
    }
  | { state: "blocking"; message: "本地数据版本已更新，请刷新当前页面" }
  | { state: "terminated"; message: "本地存储连接意外中断，请重试" };

export interface StorageLifecycleController {
  blocked(): void;
  blocking(): void;
  terminated(): void;
}

export function createStorageLifecycleController(options: {
  onHealth?: (event: StorageHealthEvent) => void;
  close: () => void;
  invalidate: () => void;
}): StorageLifecycleController {
  return {
    blocked() {
      options.onHealth?.({
        state: "blocked",
        message: "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试",
      });
    },
    blocking() {
      options.onHealth?.({ state: "blocking", message: "本地数据版本已更新，请刷新当前页面" });
      options.close();
      options.invalidate();
    },
    terminated() {
      options.onHealth?.({ state: "terminated", message: "本地存储连接意外中断，请重试" });
      options.invalidate();
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  return value;
}

function isoDateTime(value: unknown): string {
  const text = requiredText(value, 35);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  return text;
}

function parseCompanyProfile(value: unknown): CompanyProfile {
  if (!isPlainObject(value)) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  let party: Party;
  try {
    party = PartySchema.parse(value.party);
  } catch {
    throw new LocalDataError("CORRUPT_DATA");
  }
  return {
    id: requiredText(value.id, 64),
    label: requiredText(value.label, 100),
    party,
    updatedAt: isoDateTime(value.updatedAt),
  };
}

function parseStoredDraft(value: unknown): StoredDraft {
  if (!isPlainObject(value)) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  let parsedDraft: StandardGoodsQuoteDraft;
  try {
    parsedDraft = parseDocumentDraft(value.draft);
  } catch {
    throw new LocalDataError("CORRUPT_DATA");
  }
  if (
    value.id !== parsedDraft.id ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new LocalDataError("CORRUPT_DATA");
  }
  return {
    id: parsedDraft.id,
    draft: parsedDraft,
    revision: value.revision,
    savedAt: isoDateTime(value.savedAt),
  };
}

function upgradeDatabase(database: IDBPDatabase<QuotationDatabase>, oldVersion: number): void {
  if (oldVersion < 1) {
    const profiles = database.createObjectStore(COMPANY_PROFILES_STORE, { keyPath: "id" });
    profiles.createIndex("by-updated-at", "updatedAt");
    const drafts = database.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
    drafts.createIndex("by-saved-at", "savedAt");
    database.createObjectStore(META_STORE, { keyPath: "key" });
  }
  if (oldVersion < 2) {
    const documents = database.createObjectStore(DOCUMENTS_V2_STORE, { keyPath: "key" });
    documents.createIndex("by-saved-at", "savedAt");
    documents.createIndex("by-template-id", "templateId");
    const attachments = database.createObjectStore(ATTACHMENTS_STORE, {
      keyPath: "localBlobKey",
    });
    attachments.createIndex("by-document-key", "documentKey");
  }
}

export interface QuotationRepository {
  saveDraft(
    input: unknown,
    options: { makeCurrent: boolean; savedAt: string },
  ): Promise<StoredDraft>;
  getDraft(id: string): Promise<StandardGoodsQuoteDraft | null>;
  getCurrentDraft(): Promise<StandardGoodsQuoteDraft | null>;
  listDrafts(): Promise<StoredDraft[]>;
  deleteDraft(id: string): Promise<void>;
  saveCompanyProfile(input: unknown): Promise<CompanyProfile>;
  listCompanyProfiles(): Promise<CompanyProfile[]>;
  deleteCompanyProfile(id: string): Promise<void>;
  clearAllLocalData(): Promise<void>;
  close(): void;
}

export function createQuotationRepository(
  options: { databaseName?: string; onHealth?: (event: StorageHealthEvent) => void } = {},
): QuotationRepository {
  const databaseName = options.databaseName ?? QUOTATION_DATABASE_NAME;
  let database: IDBPDatabase<QuotationDatabase> | undefined;
  let opening: Promise<IDBPDatabase<QuotationDatabase>> | undefined;

  const lifecycle = createStorageLifecycleController({
    onHealth: options.onHealth,
    close: () => database?.close(),
    invalidate: () => {
      database = undefined;
      opening = undefined;
    },
  });

  async function getDatabase(): Promise<IDBPDatabase<QuotationDatabase>> {
    if (database) {
      return database;
    }
    if (!opening) {
      opening = openDB<QuotationDatabase>(databaseName, QUOTATION_DATABASE_VERSION, {
        upgrade: upgradeDatabase,
        blocked: lifecycle.blocked,
        blocking: lifecycle.blocking,
        terminated: lifecycle.terminated,
      })
        .then((opened) => {
          database = opened;
          return opened;
        })
        .catch((error: unknown) => {
          opening = undefined;
          throw normalizeLocalDataError(error);
        });
    }
    return opening;
  }

  async function run<T>(operation: (opened: IDBPDatabase<QuotationDatabase>) => Promise<T>) {
    try {
      return await operation(await getDatabase());
    } catch (error) {
      throw normalizeLocalDataError(error);
    }
  }

  return {
    async saveDraft(input, saveOptions) {
      const parsedDraft = parseDocumentDraft(input);
      const savedAt = isoDateTime(saveOptions.savedAt);
      return run(async (opened) => {
        const transaction = opened.transaction([DRAFTS_STORE, META_STORE], "readwrite");
        const drafts = transaction.objectStore(DRAFTS_STORE);
        const previous = await drafts.get(parsedDraft.id);
        const record: StoredDraft = {
          id: parsedDraft.id,
          draft: parsedDraft,
          revision: previous ? parseStoredDraft(previous).revision + 1 : 1,
          savedAt,
        };
        const requests: Array<Promise<unknown>> = [drafts.put(record)];
        if (saveOptions.makeCurrent) {
          requests.push(
            transaction.objectStore(META_STORE).put({ key: CURRENT_DRAFT_KEY, value: record.id }),
          );
        }
        await Promise.all([...requests, transaction.done]);
        return parseStoredDraft(record);
      });
    },

    async getDraft(id) {
      const safeId = requiredText(id, 64);
      return run(async (opened) => {
        const record = await opened.get(DRAFTS_STORE, safeId);
        return record ? parseStoredDraft(record).draft : null;
      });
    },

    async getCurrentDraft() {
      return run(async (opened) => {
        const transaction = opened.transaction([META_STORE, DRAFTS_STORE], "readwrite");
        const meta = transaction.objectStore(META_STORE);
        const pointer = await meta.get(CURRENT_DRAFT_KEY);
        if (!pointer || pointer.value === null) {
          await transaction.done;
          return null;
        }
        const safeId = requiredText(pointer.value, 64);
        const record = await transaction.objectStore(DRAFTS_STORE).get(safeId);
        if (record) {
          const draft = parseStoredDraft(record).draft;
          await transaction.done;
          return draft;
        }
        await Promise.all([meta.delete(CURRENT_DRAFT_KEY), transaction.done]);
        return null;
      });
    },

    async listDrafts() {
      return run(async (opened) => {
        const records = (await opened.getAll(DRAFTS_STORE)).map(parseStoredDraft);
        return records.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      });
    },

    async deleteDraft(id) {
      const safeId = requiredText(id, 64);
      await run(async (opened) => {
        const transaction = opened.transaction([DRAFTS_STORE, META_STORE], "readwrite");
        const meta = transaction.objectStore(META_STORE);
        const pointer = await meta.get(CURRENT_DRAFT_KEY);
        const requests: Array<Promise<unknown>> = [
          transaction.objectStore(DRAFTS_STORE).delete(safeId),
        ];
        if (pointer?.value === safeId) {
          requests.push(meta.delete(CURRENT_DRAFT_KEY));
        }
        await Promise.all([...requests, transaction.done]);
      });
    },

    async saveCompanyProfile(input) {
      const profile = parseCompanyProfile(input);
      return run(async (opened) => {
        await opened.put(COMPANY_PROFILES_STORE, profile);
        return parseCompanyProfile(profile);
      });
    },

    async listCompanyProfiles() {
      return run(async (opened) => {
        const profiles = (await opened.getAll(COMPANY_PROFILES_STORE)).map(parseCompanyProfile);
        return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
    },

    async deleteCompanyProfile(id) {
      const safeId = requiredText(id, 64);
      await run(async (opened) => {
        await opened.delete(COMPANY_PROFILES_STORE, safeId);
      });
    },

    async clearAllLocalData() {
      await run(async (opened) => {
        const transaction = opened.transaction(
          [COMPANY_PROFILES_STORE, DRAFTS_STORE, META_STORE, DOCUMENTS_V2_STORE, ATTACHMENTS_STORE],
          "readwrite",
        );
        await Promise.all([
          transaction.objectStore(COMPANY_PROFILES_STORE).clear(),
          transaction.objectStore(DRAFTS_STORE).clear(),
          transaction.objectStore(META_STORE).clear(),
          transaction.objectStore(DOCUMENTS_V2_STORE).clear(),
          transaction.objectStore(ATTACHMENTS_STORE).clear(),
          transaction.done,
        ]);
      });
    },

    close() {
      database?.close();
      database = undefined;
      opening = undefined;
    },
  };
}
