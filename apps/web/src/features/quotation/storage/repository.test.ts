import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuotationRepository,
  createStorageLifecycleController,
  DRAFTS_STORE,
  type StorageHealthEvent,
} from "./repository";

function draft(id: string, sellerName = "宁波远航贸易有限公司"): StandardGoodsQuoteDraft {
  const value = createStandardGoodsQuoteDraft({ id, now: "2026-08-19T10:00:00.000Z" });
  value.seller.name = sellerName;
  value.buyer.name = "上海采购有限公司";
  return value;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quotation IndexedDB repository", () => {
  it("creates the versioned stores and atomically restores the current draft", async () => {
    const repository = createQuotationRepository({ databaseName: "restore-current" });
    const input = draft("draft-current");

    const saved = await repository.saveDraft(input, {
      makeCurrent: true,
      savedAt: "2026-08-19T10:01:00.000Z",
    });

    expect(saved.revision).toBe(1);
    expect(await repository.getCurrentDraft()).toEqual(input);
    expect((await repository.listDrafts()).map((entry) => entry.id)).toEqual(["draft-current"]);
    repository.close();

    const database = await openDB("restore-current", 1);
    expect(Array.from(database.objectStoreNames)).toEqual(["companyProfiles", "drafts", "meta"]);
    expect(database.transaction("drafts").store.indexNames.contains("by-saved-at")).toBe(true);
    database.close();
  });

  it("returns isolated validated values and rejects a corrupted persisted draft", async () => {
    const databaseName = "validated-reads";
    const repository = createQuotationRepository({ databaseName });
    const input = draft("draft-safe");
    await repository.saveDraft(input, {
      makeCurrent: true,
      savedAt: "2026-08-19T10:01:00.000Z",
    });

    const restored = await repository.getDraft(input.id);
    expect(restored).toEqual(input);
    if (!restored) {
      throw new Error("Expected a restored draft");
    }
    restored.seller.name = "调用方修改";
    expect((await repository.getDraft(input.id))?.seller.name).toBe("宁波远航贸易有限公司");
    repository.close();

    const database = await openDB(databaseName, 1);
    await database.put(DRAFTS_STORE, {
      id: "draft-corrupt",
      draft: { id: "draft-corrupt", seller: { name: "损坏内容" } },
      revision: 1,
      savedAt: "2026-08-19T10:02:00.000Z",
    });
    await database.put("companyProfiles", {
      id: "profile-corrupt",
      label: "损坏公司",
      party: { name: "<script>invalid</script>" },
      updatedAt: "2026-08-19T10:02:00.000Z",
    });
    database.close();

    const reopened = createQuotationRepository({ databaseName });
    await expect(reopened.getDraft("draft-corrupt")).rejects.toMatchObject({
      code: "CORRUPT_DATA",
      message: "本地草稿数据已损坏，请删除该草稿后重试",
    });
    await expect(reopened.listCompanyProfiles()).rejects.toMatchObject({
      code: "CORRUPT_DATA",
      message: "本地草稿数据已损坏，请删除该草稿后重试",
    });
    reopened.close();
  });

  it("clears the current pointer when deleting its draft and clears all local stores", async () => {
    const repository = createQuotationRepository({ databaseName: "delete-and-clear" });
    const first = draft("draft-first");
    const second = draft("draft-second", "杭州商贸有限公司");
    await repository.saveDraft(first, {
      makeCurrent: true,
      savedAt: "2026-08-19T10:01:00.000Z",
    });
    await repository.saveDraft(second, {
      makeCurrent: false,
      savedAt: "2026-08-19T10:02:00.000Z",
    });
    await repository.saveCompanyProfile({
      id: "profile-1",
      label: "默认公司",
      party: first.seller,
      updatedAt: "2026-08-19T10:03:00.000Z",
    });

    await repository.deleteDraft(first.id);
    expect(await repository.getCurrentDraft()).toBeNull();
    expect((await repository.listDrafts()).map((entry) => entry.id)).toEqual([second.id]);

    await repository.clearAllLocalData();
    expect(await repository.listDrafts()).toEqual([]);
    expect(await repository.listCompanyProfiles()).toEqual([]);
    expect(await repository.getCurrentDraft()).toBeNull();
    repository.close();
  });

  it("increments persistent revisions and lists newest committed drafts first", async () => {
    const repository = createQuotationRepository({ databaseName: "revision-order" });
    const first = draft("draft-a");
    const second = draft("draft-b");
    await repository.saveDraft(first, {
      savedAt: "2026-08-19T10:00:00.000Z",
      makeCurrent: false,
    });
    first.seller.name = "新公司名称";
    const resaved = await repository.saveDraft(first, {
      savedAt: "2026-08-19T10:03:00.000Z",
      makeCurrent: false,
    });
    await repository.saveDraft(second, {
      savedAt: "2026-08-19T10:02:00.000Z",
      makeCurrent: false,
    });

    expect(resaved.revision).toBe(2);
    expect((await repository.listDrafts()).map((entry) => entry.id)).toEqual([first.id, second.id]);
    repository.close();
  });

  it("reports finite storage health states without logging user data", async () => {
    const health: StorageHealthEvent[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.fn();
    const invalidate = vi.fn();
    const lifecycle = createStorageLifecycleController({
      onHealth: (event) => health.push(event),
      close,
      invalidate,
    });

    lifecycle.blocked();
    lifecycle.blocking();
    lifecycle.terminated();

    expect(health).toEqual([
      {
        state: "blocked",
        message: "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试",
      },
      { state: "blocking", message: "本地数据版本已更新，请刷新当前页面" },
      { state: "terminated", message: "本地存储连接意外中断，请重试" },
    ]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("checks and clears a stale current pointer in one readwrite transaction", async () => {
    const databaseName = "atomic-current-pointer";
    const initial = createQuotationRepository({ databaseName });
    const input = draft("draft-atomic");
    await initial.saveDraft(input, {
      makeCurrent: true,
      savedAt: "2026-08-19T10:01:00.000Z",
    });
    initial.close();

    const raw = await openDB(databaseName, 1);
    await raw.delete(DRAFTS_STORE, input.id);
    raw.close();

    const repository = createQuotationRepository({ databaseName });
    await repository.listDrafts();
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");

    expect(await repository.getCurrentDraft()).toBeNull();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0]).toEqual(["meta", "drafts"]);
    expect(transaction.mock.calls[0]?.[1]).toBe("readwrite");
    repository.close();
  });
});
