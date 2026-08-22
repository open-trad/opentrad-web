import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
  serializeProject,
} from "@opentrad/document-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  CompanyProfile,
  QuotationRepository,
  StorageHealthEvent,
  StoredDraft,
} from "../storage/repository";
import { createQuotationRepository } from "../storage/repository";
import { useQuotationWorkspace } from "./useQuotationWorkspace";

function stored(draft: StandardGoodsQuoteDraft): StoredDraft {
  return { id: draft.id, draft, revision: 1, savedAt: draft.updatedAt };
}

function fakeRepository(current: StandardGoodsQuoteDraft | null = null): QuotationRepository {
  return {
    saveDraft: vi.fn(async (draft: unknown) => stored(draft as StandardGoodsQuoteDraft)),
    getDraft: vi.fn(async () => null),
    getCurrentDraft: vi.fn(async () => current),
    listDrafts: vi.fn(async () => []),
    deleteDraft: vi.fn(async () => undefined),
    saveCompanyProfile: vi.fn(async (input: unknown) => input as never),
    listCompanyProfiles: vi.fn(async () => []),
    deleteCompanyProfile: vi.fn(async () => undefined),
    clearAllLocalData: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function statefulRepository(initial: StandardGoodsQuoteDraft[]) {
  const drafts = new Map(initial.map((draft) => [draft.id, draft]));
  let currentId = initial[0]?.id ?? null;
  let profiles: CompanyProfile[] = [];
  const repository: QuotationRepository = {
    saveDraft: vi.fn(async (input: unknown, options) => {
      const draft = input as StandardGoodsQuoteDraft;
      drafts.set(draft.id, draft);
      if (options.makeCurrent) currentId = draft.id;
      return stored(draft);
    }),
    getDraft: vi.fn(async (id) => drafts.get(id) ?? null),
    getCurrentDraft: vi.fn(async () => (currentId ? (drafts.get(currentId) ?? null) : null)),
    listDrafts: vi.fn(async () => Array.from(drafts.values()).map(stored)),
    deleteDraft: vi.fn(async (id) => {
      drafts.delete(id);
      if (currentId === id) currentId = null;
    }),
    saveCompanyProfile: vi.fn(async (input: unknown) => {
      const profile = input as CompanyProfile;
      profiles = [profile, ...profiles.filter((item) => item.id !== profile.id)];
      return profile;
    }),
    listCompanyProfiles: vi.fn(async () => profiles),
    deleteCompanyProfile: vi.fn(async (id) => {
      profiles = profiles.filter((profile) => profile.id !== id);
    }),
    clearAllLocalData: vi.fn(async () => {
      drafts.clear();
      profiles = [];
      currentId = null;
    }),
    close: vi.fn(),
  };
  return { repository, drafts, getCurrentId: () => currentId };
}

const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

describe("useQuotationWorkspace lifecycle", () => {
  it("opens the default repository in the shared test environment", async () => {
    const repository = createQuotationRepository();
    await expect(repository.getCurrentDraft()).resolves.toBeNull();
    repository.close();
  });

  it("opens the default local repository and creates the first draft", async () => {
    const { result } = renderHook(() => useQuotationWorkspace({ autosaveDelayMs: 0 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(result.current.form?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("surfaces finite local storage health messages for a live region", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-storage-health",
      now: "2026-08-19T09:00:00.000Z",
    });
    const repository = fakeRepository(current);
    let emitHealth: ((event: StorageHealthEvent) => void) | undefined;
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        createRepository: (onHealth) => {
          emitHealth = onHealth;
          return repository;
        },
        now: () => "2026-08-19T10:00:00.000Z",
        autosaveDelayMs: 0,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emitHealth?.({
        state: "blocked",
        message: "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试",
      });
    });
    expect(result.current.storageHealthMessage).toBe(
      "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试",
    );
  });

  it("creates and saves one stable current draft on first load even in StrictMode", async () => {
    const repository = fakeRepository();
    const createId = vi.fn(() => "draft-stable-first");

    const { result } = renderHook(
      () =>
        useQuotationWorkspace({
          repository,
          createId,
          now: () => "2026-08-19T10:00:00.000Z",
          autosaveDelayMs: 0,
        }),
      { wrapper: strictWrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.form?.id).toBe("draft-stable-first");
    expect(createId).toHaveBeenCalledTimes(1);
    expect(repository.getCurrentDraft).toHaveBeenCalledTimes(1);
    expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.any(Object), {
      makeCurrent: true,
      savedAt: "2026-08-19T10:00:00.000Z",
    });
  });

  it("hydrates a saved current draft without creating or resaving it", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-restored",
      now: "2026-08-19T09:00:00.000Z",
    });
    current.seller.name = "刷新恢复的公司";
    const repository = fakeRepository(current);
    const createId = vi.fn(() => "should-not-create");

    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        createId,
        now: () => "2026-08-19T10:00:00.000Z",
        autosaveDelayMs: 0,
      }),
    );

    await waitFor(() => expect(result.current.form?.seller.name).toBe("刷新恢复的公司"));
    expect(createId).not.toHaveBeenCalled();
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });

  it("keeps the last valid preview while invalid raw input blocks autosave", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-valid-preview",
      now: "2026-08-19T09:00:00.000Z",
    });
    const repository = fakeRepository(current);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 0,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const modelBefore = result.current.previewModel;

    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        lineItems: form.lineItems.map((line, index) =>
          index === 0 ? { ...line, unitPriceMajor: "1.005" } : line,
        ),
      }));
    });

    expect(result.current.form?.lineItems[0]?.unitPriceMajor).toBe("1.005");
    expect(result.current.validationErrors["lineItems.0.unitPriceMajor"]).toMatch(/最多保留 2 位/);
    expect(result.current.previewModel).toBe(modelBefore);
    expect(result.current.previewStale).toBe(true);
    await act(async () => Promise.resolve());
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });

  it("reports saving then saved and flushes a valid draft on pagehide", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-autosave",
      now: "2026-08-19T09:00:00.000Z",
    });
    let releaseSave: (() => void) | undefined;
    const repository = fakeRepository(current);
    vi.mocked(repository.saveDraft).mockImplementation(
      (draft) =>
        new Promise<StoredDraft>((resolve) => {
          releaseSave = () => resolve(stored(draft as StandardGoodsQuoteDraft));
        }),
    );
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 0,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        seller: { ...form.seller, name: "自动保存公司" },
      }));
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(result.current.autosaveStatus).toBe("saving"));
    expect(repository.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ seller: expect.objectContaining({ name: "自动保存公司" }) }),
      { makeCurrent: true, savedAt: "2026-08-19T10:00:00.000Z" },
    );

    await act(async () => releaseSave?.());
    await waitFor(() => expect(result.current.autosaveStatus).toBe("saved"));
  });

  it("does not report a failed manual flush as saved", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-save-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const repository = fakeRepository(current);
    vi.mocked(repository.saveDraft).mockRejectedValue(new Error("secret raw storage error"));
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        buyer: { ...form.buyer, name: "手动保存客户" },
      }));
    });

    let saved = true;
    await act(async () => {
      saved = await result.current.saveNow();
    });
    expect(saved).toBe(false);
    expect(result.current.autosaveStatus).toBe("error");
    expect(result.current.statusMessage).toBe("草稿保存失败，请检查浏览器存储空间后重试");
  });

  it("changes a previously saved state to needs-correction for invalid raw input and manual save", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-invalid-after-save",
      now: "2026-08-19T09:00:00.000Z",
    });
    const repository = fakeRepository(current);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.saveNow()).toBe(true);
    });
    expect(result.current.autosaveStatus).toBe("saved");

    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        lineItems: form.lineItems.map((line, index) =>
          index === 0 ? { ...line, quantity: "0" } : line,
        ),
      }));
    });
    expect(result.current.autosaveStatus).toBe("needs-correction");
    expect(result.current.statusMessage).toBe("请修正表单错误后再保存");
    await act(async () => {
      expect(await result.current.saveNow()).toBe(false);
    });
    expect(result.current.autosaveStatus).toBe("needs-correction");
  });

  it("resets a needs-correction status after creating and hydrating a valid draft", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-invalid-before-new",
      now: "2026-08-19T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "draft-neutral-new",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        seller: { ...form.seller, name: "待保存的有效报价方" },
      }));
      result.current.updateForm((form) => ({
        ...form,
        lineItems: form.lineItems.map((line, index) =>
          index === 0 ? { ...line, quantity: "0" } : line,
        ),
      }));
    });
    expect(result.current.autosaveStatus).toBe("needs-correction");

    await act(async () => expect(await result.current.createNewDraft()).toBe(true));
    expect(result.current.form?.id).toBe("draft-neutral-new");
    expect(result.current.autosaveStatus).toBe("idle");
    expect(result.current.statusMessage).toBe("所有数据仅保存在当前设备");
  });

  it("resets a save error after loading and hydrating another valid draft", async () => {
    const first = createStandardGoodsQuoteDraft({
      id: "draft-error-before-load",
      now: "2026-08-19T09:00:00.000Z",
    });
    const second = createStandardGoodsQuoteDraft({
      id: "draft-valid-load",
      now: "2026-08-19T09:10:00.000Z",
    });
    const state = statefulRepository([first, second]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(2));
    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        buyer: { ...form.buyer, name: "触发保存失败的客户" },
      }));
    });
    vi.mocked(state.repository.saveDraft).mockRejectedValueOnce(new Error("raw storage detail"));
    await act(async () => expect(await result.current.saveNow()).toBe(false));
    expect(result.current.autosaveStatus).toBe("error");

    await act(async () => expect(await result.current.loadDraft("draft-valid-load")).toBe(true));
    expect(result.current.form?.id).toBe("draft-valid-load");
    expect(result.current.autosaveStatus).toBe("idle");
    expect(result.current.statusMessage).toBe("所有数据仅保存在当前设备");
  });

  it("resets a needs-correction status after importing and hydrating a valid copy", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-invalid-before-import",
      now: "2026-08-19T09:00:00.000Z",
    });
    const imported = createStandardGoodsQuoteDraft({
      id: "untrusted-neutral-import",
      now: "2026-08-18T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "safe-neutral-import",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        lineItems: form.lineItems.map((line, index) =>
          index === 0 ? { ...line, unitPriceMajor: "1.005" } : line,
        ),
      }));
    });
    expect(result.current.autosaveStatus).toBe("needs-correction");

    const serialized = serializeProject(imported);
    const file = new File([serialized], "neutral.opentrad", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => serialized });
    await act(async () => expect(await result.current.importProjectFile(file)).toBe(true));
    expect(result.current.form?.id).toBe("safe-neutral-import");
    expect(result.current.autosaveStatus).toBe("idle");
    expect(result.current.statusMessage).toBe("所有数据仅保存在当前设备");
  });

  it("flushes a pending valid draft on unmount without emitting post-unmount state", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-unmount-flush",
      now: "2026-08-19T09:00:00.000Z",
    });
    const repository = fakeRepository(current);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        seller: { ...form.seller, name: "卸载前待保存公司" },
      }));
    });
    unmount();

    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalledTimes(1));
    expect(repository.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ seller: expect.objectContaining({ name: "卸载前待保存公司" }) }),
      { makeCurrent: true, savedAt: "2026-08-19T10:00:00.000Z" },
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("saves, applies, lists and deletes seller company profiles", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-profile-actions",
      now: "2026-08-19T09:00:00.000Z",
    });
    current.seller.name = "宁波远航贸易有限公司";
    const { repository } = statefulRepository([current]);
    const ids = ["profile-default"];
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => ids.shift() ?? "unused-id",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.saveSellerProfile(" 默认出口公司 ")).toBe(true);
    });
    expect(result.current.companyProfiles).toHaveLength(1);
    expect(result.current.companyProfiles[0]).toMatchObject({
      id: "profile-default",
      label: "默认出口公司",
      party: { name: "宁波远航贸易有限公司" },
    });

    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        seller: { ...form.seller, name: "临时修改公司" },
      }));
      expect(result.current.applyCompanyProfile("profile-default")).toBe(true);
    });
    expect(result.current.form?.seller.name).toBe("宁波远航贸易有限公司");

    await act(async () => {
      expect(await result.current.deleteCompanyProfile("profile-default")).toBe(true);
    });
    expect(result.current.companyProfiles).toEqual([]);
  });

  it("validates seller profiles independently from invalid buyer and line form state", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-independent-profile",
      now: "2026-08-19T09:00:00.000Z",
    });
    current.seller.name = "可保存的报价方";
    const { repository } = statefulRepository([current]);
    const ids = ["profile-independent"];
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => ids.shift() ?? "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.updateForm((form) => ({
        ...form,
        buyer: { ...form.buyer, name: "" },
        lineItems: form.lineItems.map((line, index) =>
          index === 0 ? { ...line, unitPriceMajor: "1.005" } : line,
        ),
      }));
    });

    await act(async () => expect(await result.current.saveSellerProfile("独立档案")).toBe(true));
    expect(result.current.companyProfiles[0]?.party.name).toBe("可保存的报价方");

    act(() => {
      result.current.updateForm((form) => ({ ...form, seller: { ...form.seller, name: "" } }));
    });
    await act(async () => expect(await result.current.saveSellerProfile("无效档案")).toBe(false));
    expect(result.current.operationMessage).toBe("报价方信息无效，请检查名称和字段长度");
  });

  it("does not report profile save success when refreshing collections fails", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-profile-refresh-save",
      now: "2026-08-19T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "profile-refresh-save",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(1));
    vi.mocked(state.repository.listDrafts).mockRejectedValueOnce(new Error("raw list detail"));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.saveSellerProfile("刷新失败档案");
    });
    expect(state.repository.saveCompanyProfile).toHaveBeenCalledTimes(1);
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("does not report profile deletion success when refreshing collections fails", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-profile-refresh-delete",
      now: "2026-08-19T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    await state.repository.saveCompanyProfile({
      id: "profile-refresh-delete",
      label: "待删除档案",
      party: current.seller,
      updatedAt: "2026-08-19T09:00:00.000Z",
    });
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.companyProfiles).toHaveLength(1));
    vi.mocked(state.repository.listCompanyProfiles).mockRejectedValueOnce(
      new Error("raw list detail"),
    );

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.deleteCompanyProfile("profile-refresh-delete");
    });
    expect(state.repository.deleteCompanyProfile).toHaveBeenCalledWith("profile-refresh-delete");
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("does not report new draft success when refreshing collections fails", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-before-new-refresh-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "draft-created-before-refresh-failure",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(1));
    vi.mocked(state.repository.listDrafts).mockRejectedValueOnce(new Error("raw list detail"));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.createNewDraft();
    });
    expect(state.drafts.has("draft-created-before-refresh-failure")).toBe(true);
    expect(result.current.form?.id).toBe("draft-created-before-refresh-failure");
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("does not report draft load success when refreshing collections fails", async () => {
    const first = createStandardGoodsQuoteDraft({
      id: "draft-before-load-refresh-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const second = createStandardGoodsQuoteDraft({
      id: "draft-loaded-before-refresh-failure",
      now: "2026-08-19T09:10:00.000Z",
    });
    const state = statefulRepository([first, second]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(2));
    vi.mocked(state.repository.listCompanyProfiles).mockRejectedValueOnce(
      new Error("raw list detail"),
    );

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.loadDraft("draft-loaded-before-refresh-failure");
    });
    expect(result.current.form?.id).toBe("draft-loaded-before-refresh-failure");
    expect(state.getCurrentId()).toBe("draft-loaded-before-refresh-failure");
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("does not report clear-all success when refreshing collections fails", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-before-clear-refresh-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "draft-after-clear-refresh-failure",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(1));
    vi.mocked(state.repository.listDrafts).mockRejectedValueOnce(new Error("raw list detail"));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.clearAllLocalData();
    });
    expect(state.repository.clearAllLocalData).toHaveBeenCalledTimes(1);
    expect(result.current.form?.id).toBe("draft-after-clear-refresh-failure");
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("does not report import success when refreshing collections fails", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-before-import-refresh-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const imported = createStandardGoodsQuoteDraft({
      id: "untrusted-refresh-failure",
      now: "2026-08-18T09:00:00.000Z",
    });
    const state = statefulRepository([current]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "safe-import-before-refresh-failure",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(1));
    vi.mocked(state.repository.listCompanyProfiles).mockRejectedValueOnce(
      new Error("raw list detail"),
    );
    const serialized = serializeProject(imported);
    const file = new File([serialized], "refresh-failure.opentrad", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", { value: async () => serialized });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.importProjectFile(file);
    });
    expect(result.current.form?.id).toBe("safe-import-before-refresh-failure");
    expect(state.drafts.has("safe-import-before-refresh-failure")).toBe(true);
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("preserves the collection read error when a completed draft deletion cannot refresh", async () => {
    const first = createStandardGoodsQuoteDraft({
      id: "draft-current-before-delete-refresh-failure",
      now: "2026-08-19T09:00:00.000Z",
    });
    const second = createStandardGoodsQuoteDraft({
      id: "draft-deleted-before-refresh-failure",
      now: "2026-08-19T09:10:00.000Z",
    });
    const state = statefulRepository([first, second]);
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => "unused",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(2));
    vi.mocked(state.repository.listDrafts).mockRejectedValueOnce(new Error("raw list detail"));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.deleteSavedDraft("draft-deleted-before-refresh-failure");
    });
    expect(state.drafts.has("draft-deleted-before-refresh-failure")).toBe(false);
    expect(succeeded).toBe(false);
    expect(result.current.operationMessage).toBe(
      "无法读取本机档案或草稿列表，请检查浏览器存储后重试",
    );
  });

  it("creates, lists, loads and deletes drafts, then recreates one after clear-all", async () => {
    const first = createStandardGoodsQuoteDraft({
      id: "draft-first",
      now: "2026-08-19T09:00:00.000Z",
    });
    const second = createStandardGoodsQuoteDraft({
      id: "draft-second",
      now: "2026-08-19T09:10:00.000Z",
    });
    second.buyer.name = "第二草稿客户";
    const state = statefulRepository([first, second]);
    const ids = ["draft-new", "draft-after-clear"];
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => ids.shift() ?? "unused-id",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(2));

    await act(async () => expect(await result.current.createNewDraft()).toBe(true));
    expect(result.current.form?.id).toBe("draft-new");
    expect(result.current.savedDrafts.map((entry) => entry.id)).toContain("draft-new");

    await act(async () => expect(await result.current.loadDraft("draft-second")).toBe(true));
    expect(result.current.form?.buyer.name).toBe("第二草稿客户");
    expect(state.getCurrentId()).toBe("draft-second");

    await act(async () => expect(await result.current.deleteSavedDraft("draft-second")).toBe(true));
    expect(result.current.savedDrafts.map((entry) => entry.id)).not.toContain("draft-second");
    expect(result.current.form?.id).not.toBe("draft-second");

    await act(async () => expect(await result.current.clearAllLocalData()).toBe(true));
    expect(state.repository.clearAllLocalData).toHaveBeenCalledTimes(1);
    expect(result.current.form?.id).toBe("draft-after-clear");
    expect(result.current.savedDrafts.map((entry) => entry.id)).toEqual(["draft-after-clear"]);
  });

  it("imports a valid project only as a safe new draft copy and rejects invalid or oversized files", async () => {
    const current = createStandardGoodsQuoteDraft({
      id: "draft-before-import",
      now: "2026-08-19T09:00:00.000Z",
    });
    const imported = createStandardGoodsQuoteDraft({
      id: "untrusted-import-id",
      now: "2026-08-18T09:00:00.000Z",
    });
    imported.seller.name = "导入的公司";
    const state = statefulRepository([current]);
    const ids = ["safe-import-copy"];
    const { result } = renderHook(() =>
      useQuotationWorkspace({
        repository: state.repository,
        now: () => "2026-08-19T10:00:00.000Z",
        createId: () => ids.shift() ?? "unused-id",
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const serialized = serializeProject(imported);
    const validFile = new File([serialized], "valid.opentrad", { type: "application/json" });
    Object.defineProperty(validFile, "text", { value: async () => serialized });
    await act(async () => expect(await result.current.importProjectFile(validFile)).toBe(true));
    expect(result.current.form?.id).toBe("safe-import-copy");
    expect(result.current.form?.seller.name).toBe("导入的公司");
    expect(state.drafts.has("untrusted-import-id")).toBe(false);
    expect(state.drafts.has("safe-import-copy")).toBe(true);

    const currentAfterValid = result.current.form?.id;
    const invalidFile = new File(["not-json"], "invalid.opentrad", { type: "application/json" });
    Object.defineProperty(invalidFile, "text", { value: async () => "not-json" });
    await act(async () => expect(await result.current.importProjectFile(invalidFile)).toBe(false));
    expect(result.current.form?.id).toBe(currentAfterValid);
    expect(result.current.operationMessage).toBe("项目文件无效或版本不受支持");

    const oversized = new File(["x"], "oversized.opentrad", { type: "application/json" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });
    Object.defineProperty(oversized, "text", { value: async () => "x" });
    await act(async () => expect(await result.current.importProjectFile(oversized)).toBe(false));
    expect(result.current.form?.id).toBe(currentAfterValid);
    expect(result.current.operationMessage).toMatch(/超过 1 MiB/);
  });
});
