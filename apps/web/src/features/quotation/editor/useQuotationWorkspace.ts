import {
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  type DocumentModel,
  PartySchema,
  parseDocumentDraft,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectFileError, type ProjectFileLike, readProjectFile } from "../project/projectFiles";
import {
  type AutosaveStatus as CoordinatorStatus,
  createAutosaveCoordinator,
} from "../storage/autosave";
import {
  type CompanyProfile,
  createQuotationRepository,
  type QuotationRepository,
  type StorageHealthEvent,
  type StoredDraft,
} from "../storage/repository";
import { buildDraftFromForm, draftToFormState, type QuotationFormState } from "./draftConversion";

export type WorkspaceAutosaveStatus = "idle" | "saving" | "saved" | "error" | "needs-correction";

export interface QuotationWorkspaceOptions {
  repository?: QuotationRepository;
  createRepository?: (onHealth: (event: StorageHealthEvent) => void) => QuotationRepository;
  now?: () => string;
  createId?: () => string;
  autosaveDelayMs?: number;
}

const pendingInitializations = new WeakMap<QuotationRepository, Promise<StandardGoodsQuoteDraft>>();
const activeRepositoryEffects = new WeakMap<QuotationRepository, number>();
const currentIsoTime = () => new Date().toISOString();
const createUuid = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function initializeCurrentDraft(
  repository: QuotationRepository,
  createId: () => string,
  now: () => string,
): Promise<StandardGoodsQuoteDraft> {
  const pending = pendingInitializations.get(repository);
  if (pending) return pending;
  const initialization = (async () => {
    const current = await repository.getCurrentDraft();
    if (current) return current;
    const createdAt = now();
    const draft = createStandardGoodsQuoteDraft({ id: createId(), now: createdAt });
    await repository.saveDraft(draft, { makeCurrent: true, savedAt: createdAt });
    return draft;
  })();
  pendingInitializations.set(repository, initialization);
  const clearPending = () => {
    if (pendingInitializations.get(repository) === initialization) {
      pendingInitializations.delete(repository);
    }
  };
  void initialization.then(clearPending, clearPending);
  return initialization;
}

function statusText(status: WorkspaceAutosaveStatus): string {
  switch (status) {
    case "saving":
      return "正在保存草稿";
    case "saved":
      return "草稿已保存在当前设备";
    case "error":
      return "草稿保存失败，请检查浏览器存储空间后重试";
    case "needs-correction":
      return "请修正表单错误后再保存";
    default:
      return "所有数据仅保存在当前设备";
  }
}

export function useQuotationWorkspace(options: QuotationWorkspaceOptions = {}) {
  const [storageHealthMessage, setStorageHealthMessage] = useState("");
  const repositoryRef = useRef<QuotationRepository | null>(null);
  if (!repositoryRef.current) {
    repositoryRef.current =
      options.repository ??
      (options.createRepository ?? ((onHealth) => createQuotationRepository({ onHealth })))(
        (event) => setStorageHealthMessage(event.message),
      );
  }
  const ownsRepositoryRef = useRef(!options.repository);
  const nowRef = useRef(options.now ?? currentIsoTime);
  const createIdRef = useRef(options.createId ?? createUuid);
  const autosaveDelayRef = useRef(options.autosaveDelayMs ?? 700);
  const repository = repositoryRef.current;
  const now = nowRef.current;
  const createId = createIdRef.current;
  const autosaveDelayMs = autosaveDelayRef.current;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<QuotationFormState | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [previewModel, setPreviewModel] = useState<DocumentModel | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<WorkspaceAutosaveStatus>("idle");
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<StoredDraft[]>([]);
  const [operationMessage, setOperationMessage] = useState("");
  const formRef = useRef<QuotationFormState | null>(null);
  const lastValidDraftRef = useRef<StandardGoodsQuoteDraft | null>(null);
  const coordinatorRef = useRef<ReturnType<typeof createAutosaveCoordinator> | null>(null);
  const latestStatusRef = useRef<WorkspaceAutosaveStatus>("idle");
  const invalidFormRef = useRef(false);

  const hydrateDraft = useCallback((draft: StandardGoodsQuoteDraft) => {
    const hydrated = draftToFormState(draft);
    formRef.current = hydrated;
    lastValidDraftRef.current = draft;
    invalidFormRef.current = false;
    latestStatusRef.current = "idle";
    setForm(hydrated);
    setAutosaveStatus("idle");
    setPreviewModel(compileStandardGoodsQuote(draft));
    setValidationErrors({});
    setPreviewStale(false);
  }, []);

  const refreshCollections = useCallback(async () => {
    try {
      const [profiles, drafts] = await Promise.all([
        repository.listCompanyProfiles(),
        repository.listDrafts(),
      ]);
      setCompanyProfiles(profiles);
      setSavedDrafts(drafts);
      return true;
    } catch {
      setOperationMessage("无法读取本机档案或草稿列表，请检查浏览器存储后重试");
      return false;
    }
  }, [repository]);

  useEffect(() => {
    let active = true;
    if (ownsRepositoryRef.current) {
      activeRepositoryEffects.set(repository, (activeRepositoryEffects.get(repository) ?? 0) + 1);
    }
    const setStatus = (status: CoordinatorStatus) => {
      const next = invalidFormRef.current ? "needs-correction" : status.state;
      latestStatusRef.current = next;
      if (active) setAutosaveStatus(next);
    };
    const coordinator = createAutosaveCoordinator({
      delayMs: autosaveDelayMs,
      save: (draft) => repository.saveDraft(draft, { makeCurrent: true, savedAt: now() }),
      onStatus: setStatus,
    });
    coordinatorRef.current = coordinator;
    const handlePageHide = () => {
      void coordinator.flush();
    };
    window.addEventListener("pagehide", handlePageHide);

    void initializeCurrentDraft(repository, createId, now)
      .then((draft) => {
        if (!active) return;
        hydrateDraft(draft);
        setLoadError(null);
        setLoading(false);
        void refreshCollections();
      })
      .catch(() => {
        if (!active) return;
        setLoadError("无法读取本机草稿，请检查浏览器存储权限后重试");
        setLoading(false);
      });

    return () => {
      active = false;
      if (ownsRepositoryRef.current) {
        activeRepositoryEffects.set(
          repository,
          Math.max(0, (activeRepositoryEffects.get(repository) ?? 1) - 1),
        );
      }
      window.removeEventListener("pagehide", handlePageHide);
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
      void coordinator.flush().finally(() => {
        coordinator.dispose();
        if (ownsRepositoryRef.current && activeRepositoryEffects.get(repository) === 0) {
          repository.close();
          activeRepositoryEffects.delete(repository);
        }
      });
    };
  }, [autosaveDelayMs, createId, hydrateDraft, now, refreshCollections, repository]);

  const updateForm = useCallback(
    (updater: (current: QuotationFormState) => QuotationFormState) => {
      const current = formRef.current;
      if (!current) return;
      const next = updater(current);
      formRef.current = next;
      setForm(next);
      const result = buildDraftFromForm(next, now());
      if (!result.ok) {
        invalidFormRef.current = true;
        latestStatusRef.current = "needs-correction";
        setAutosaveStatus("needs-correction");
        setValidationErrors(result.errors);
        setPreviewStale(true);
        return;
      }
      lastValidDraftRef.current = result.draft;
      invalidFormRef.current = false;
      if (latestStatusRef.current === "needs-correction") {
        latestStatusRef.current = "idle";
        setAutosaveStatus("idle");
      }
      setValidationErrors({});
      setPreviewModel(compileStandardGoodsQuote(result.draft));
      setPreviewStale(false);
      coordinatorRef.current?.schedule(result.draft);
    },
    [now],
  );

  const validate = useCallback(() => {
    const current = formRef.current;
    if (!current) return { ok: false, errors: {} } as const;
    const result = buildDraftFromForm(current, now());
    if (!result.ok) {
      invalidFormRef.current = true;
      latestStatusRef.current = "needs-correction";
      setAutosaveStatus("needs-correction");
      setValidationErrors(result.errors);
      setPreviewStale(true);
      return result;
    }
    lastValidDraftRef.current = result.draft;
    invalidFormRef.current = false;
    setValidationErrors({});
    setPreviewModel(compileStandardGoodsQuote(result.draft));
    setPreviewStale(false);
    return result;
  }, [now]);

  const saveNow = useCallback(async () => {
    const current = formRef.current;
    if (!current || !coordinatorRef.current) return false;
    const result = buildDraftFromForm(current, now());
    if (!result.ok) {
      invalidFormRef.current = true;
      latestStatusRef.current = "needs-correction";
      setAutosaveStatus("needs-correction");
      setValidationErrors(result.errors);
      setPreviewStale(true);
      return false;
    }
    invalidFormRef.current = false;
    coordinatorRef.current.schedule(result.draft);
    await coordinatorRef.current.flush();
    return latestStatusRef.current === "saved";
  }, [now]);

  const flushPending = useCallback(async () => {
    await coordinatorRef.current?.flush();
  }, []);

  const saveSellerProfile = useCallback(
    async (labelInput: string) => {
      const label = labelInput.trim();
      const current = formRef.current;
      if (!label) {
        setOperationMessage("请填写公司档案名称");
        return false;
      }
      if (!current) return false;
      const seller = PartySchema.safeParse(current.seller);
      if (!seller.success) {
        setOperationMessage("报价方信息无效，请检查名称和字段长度");
        return false;
      }
      try {
        await repository.saveCompanyProfile({
          id: createId(),
          label,
          party: seller.data,
          updatedAt: now(),
        });
        if (!(await refreshCollections())) return false;
        setOperationMessage("公司档案已保存在当前设备");
        return true;
      } catch {
        setOperationMessage("公司档案保存失败，请检查浏览器存储后重试");
        return false;
      }
    },
    [createId, now, refreshCollections, repository],
  );

  const applyCompanyProfile = useCallback(
    (id: string) => {
      const profile = companyProfiles.find((item) => item.id === id);
      if (!profile) {
        setOperationMessage("未找到该公司档案");
        return false;
      }
      updateForm((current) => ({
        ...current,
        seller: {
          name: profile.party.name,
          address: profile.party.address ?? "",
          contactName: profile.party.contactName ?? "",
          phone: profile.party.phone ?? "",
          email: profile.party.email ?? "",
          taxId: profile.party.taxId ?? "",
          bankName: profile.party.bankName ?? "",
          bankAccount: profile.party.bankAccount ?? "",
        },
      }));
      setOperationMessage("已应用公司档案");
      return true;
    },
    [companyProfiles, updateForm],
  );

  const deleteCompanyProfile = useCallback(
    async (id: string) => {
      try {
        await repository.deleteCompanyProfile(id);
        if (!(await refreshCollections())) return false;
        setOperationMessage("公司档案已删除");
        return true;
      } catch {
        setOperationMessage("公司档案删除失败，请重试");
        return false;
      }
    },
    [refreshCollections, repository],
  );

  const createAndPersistDraft = useCallback(async () => {
    const instant = now();
    const draft = createStandardGoodsQuoteDraft({ id: createId(), now: instant });
    await repository.saveDraft(draft, { makeCurrent: true, savedAt: instant });
    hydrateDraft(draft);
    return draft;
  }, [createId, hydrateDraft, now, repository]);

  const createNewDraft = useCallback(async () => {
    try {
      await flushPending();
      await createAndPersistDraft();
      if (!(await refreshCollections())) return false;
      setOperationMessage("已新建本机草稿");
      return true;
    } catch {
      setOperationMessage("新建草稿失败，请检查浏览器存储后重试");
      return false;
    }
  }, [createAndPersistDraft, flushPending, refreshCollections]);

  const loadDraft = useCallback(
    async (id: string) => {
      try {
        await flushPending();
        const draft = await repository.getDraft(id);
        if (!draft) {
          setOperationMessage("未找到该草稿，可能已被删除");
          return false;
        }
        const instant = now();
        await repository.saveDraft(draft, { makeCurrent: true, savedAt: instant });
        hydrateDraft(draft);
        if (!(await refreshCollections())) return false;
        setOperationMessage("已切换到所选草稿");
        return true;
      } catch {
        setOperationMessage("草稿载入失败，请检查本机存储后重试");
        return false;
      }
    },
    [flushPending, hydrateDraft, now, refreshCollections, repository],
  );

  const deleteSavedDraft = useCallback(
    async (id: string) => {
      try {
        await flushPending();
        const deletingCurrent = formRef.current?.id === id;
        await repository.deleteDraft(id);
        const readDrafts = async () => {
          try {
            return await repository.listDrafts();
          } catch {
            setOperationMessage("无法读取本机档案或草稿列表，请检查浏览器存储后重试");
            return null;
          }
        };
        let drafts = await readDrafts();
        if (!drafts) return false;
        if (deletingCurrent) {
          const fallback = drafts[0]?.draft;
          if (fallback) {
            await repository.saveDraft(fallback, { makeCurrent: true, savedAt: now() });
            hydrateDraft(fallback);
          } else {
            await createAndPersistDraft();
            drafts = await readDrafts();
            if (!drafts) return false;
          }
        }
        setSavedDrafts(drafts);
        setOperationMessage("草稿已删除");
        return true;
      } catch {
        setOperationMessage("草稿删除失败，请重试");
        return false;
      }
    },
    [createAndPersistDraft, flushPending, hydrateDraft, now, repository],
  );

  const clearAllLocalData = useCallback(async () => {
    try {
      await flushPending();
      await repository.clearAllLocalData();
      await createAndPersistDraft();
      if (!(await refreshCollections())) return false;
      setOperationMessage("本机报价数据已清空，并已建立新草稿");
      return true;
    } catch {
      setOperationMessage("清空本机数据失败，请重试");
      return false;
    }
  }, [createAndPersistDraft, flushPending, refreshCollections, repository]);

  const importProjectFile = useCallback(
    async (file: ProjectFileLike) => {
      try {
        await flushPending();
        const envelope = await readProjectFile(file);
        const instant = now();
        const copy = parseDocumentDraft({
          ...envelope.draft,
          id: createId(),
          updatedAt: instant,
        });
        await repository.saveDraft(copy, { makeCurrent: true, savedAt: instant });
        hydrateDraft(copy);
        if (!(await refreshCollections())) return false;
        setOperationMessage("项目已作为新的本机草稿副本导入");
        return true;
      } catch (error) {
        setOperationMessage(
          error instanceof ProjectFileError
            ? error.message
            : "项目导入失败，请选择有效的 OpenTrad 项目文件",
        );
        return false;
      }
    },
    [createId, flushPending, hydrateDraft, now, refreshCollections, repository],
  );

  return {
    repository,
    loading,
    loadError,
    form,
    validationErrors,
    previewModel,
    previewStale,
    autosaveStatus,
    statusMessage: statusText(autosaveStatus),
    companyProfiles,
    savedDrafts,
    operationMessage,
    storageHealthMessage,
    lastValidDraft: lastValidDraftRef.current,
    updateForm,
    validate,
    saveNow,
    saveSellerProfile,
    applyCompanyProfile,
    deleteCompanyProfile,
    createNewDraft,
    loadDraft,
    deleteSavedDraft,
    clearAllLocalData,
    importProjectFile,
  };
}
