import { Building2, FileArchive, FolderOpen, Import, X } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { useQuotationWorkspace } from "./useQuotationWorkspace";

type Workspace = ReturnType<typeof useQuotationWorkspace>;
type OpenPanel = "profiles" | "drafts" | null;
type Confirmation =
  | { kind: "delete-profile"; id: string }
  | { kind: "delete-draft"; id: string }
  | { kind: "clear-all" }
  | { kind: "import"; file: File }
  | null;

export function WorkspaceManagers({ workspace }: { workspace: Workspace }) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [profileLabel, setProfileLabel] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyActionRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const confirmationReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const profilesTitleId = useId();
  const draftsTitleId = useId();

  const closePanel = () => {
    if (busyActionRef.current) return;
    setOpenPanel(null);
    setConfirmation(null);
    queueMicrotask(() => returnFocusRef.current?.focus());
  };

  const closeConfirmation = (restoreFocus = true) => {
    if (busyActionRef.current) return;
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "import" && importInputRef.current) {
      importInputRef.current.value = "";
    }
    if (restoreFocus) {
      queueMicrotask(() => confirmationReturnFocusRef.current?.focus());
    }
  };

  const openConfirmation = (next: Exclude<Confirmation, null>, opener: HTMLButtonElement) => {
    if (busyActionRef.current) return;
    confirmationReturnFocusRef.current = opener;
    setConfirmation(next);
  };

  const startBusyAction = (action: string) => {
    if (busyActionRef.current) return false;
    busyActionRef.current = action;
    setBusyAction(action);
    return true;
  };

  const finishBusyAction = (action: string) => {
    if (busyActionRef.current !== action) return;
    busyActionRef.current = null;
    setBusyAction(null);
  };

  const runImmediateAction = async (action: string, run: () => Promise<unknown>) => {
    if (!startBusyAction(action)) return;
    try {
      await run();
    } finally {
      finishBusyAction(action);
    }
  };

  useEffect(() => {
    if (openPanel) queueMicrotask(() => dialogCloseRef.current?.focus());
  }, [openPanel]);

  useEffect(() => {
    if (confirmation) queueMicrotask(() => confirmationCancelRef.current?.focus());
  }, [confirmation]);

  useEffect(() => {
    if (!openPanel && !confirmation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (busyActionRef.current) return;
      if (confirmation) closeConfirmation();
      else closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const open = (panel: Exclude<OpenPanel, null>, opener: HTMLButtonElement) => {
    returnFocusRef.current = opener;
    setOpenPanel(panel);
  };

  const onImportSelection = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(?:json|opentrad)$/iu.test(file.name)) {
      setLocalMessage("仅支持 .json 或 .opentrad 项目文件");
      if (importInputRef.current) importInputRef.current.value = "";
      queueMicrotask(() => importButtonRef.current?.focus());
      return;
    }
    setLocalMessage("");
    if (importButtonRef.current) {
      openConfirmation({ kind: "import", file }, importButtonRef.current);
    }
  };

  const runConfirmation = async () => {
    const current = confirmation;
    if (!current || !startBusyAction(current.kind)) return;
    let succeeded = false;
    try {
      if (current.kind === "delete-profile") {
        succeeded = await workspace.deleteCompanyProfile(current.id);
      } else if (current.kind === "delete-draft") {
        succeeded = await workspace.deleteSavedDraft(current.id);
      } else if (current.kind === "clear-all") {
        succeeded = await workspace.clearAllLocalData();
      } else {
        succeeded = await workspace.importProjectFile(current.file);
      }
    } finally {
      finishBusyAction(current.kind);
    }
    if (succeeded) {
      setConfirmation(null);
      if (current.kind === "import" && importInputRef.current) {
        importInputRef.current.value = "";
      }
      queueMicrotask(() => {
        if (current.kind === "import") importButtonRef.current?.focus();
        else dialogCloseRef.current?.focus();
      });
      return;
    }
    if (current.kind === "import") {
      setConfirmation(null);
      if (importInputRef.current) importInputRef.current.value = "";
      queueMicrotask(() => importButtonRef.current?.focus());
    } else {
      queueMicrotask(() => confirmationCancelRef.current?.focus());
    }
  };

  return (
    <>
      <fieldset className="workspace-manager-actions">
        <legend className="sr-only">本机工作区管理</legend>
        <button
          type="button"
          className="secondary-button"
          onClick={(event) => open("profiles", event.currentTarget)}
        >
          <Building2 size={16} /> 公司档案
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={(event) => open("drafts", event.currentTarget)}
        >
          <FolderOpen size={16} /> 草稿管理
        </button>
        <button
          ref={importButtonRef}
          type="button"
          className="secondary-button import-button"
          onClick={() => importInputRef.current?.click()}
        >
          <Import size={16} /> 导入项目
        </button>
        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          accept=".json,.opentrad"
          aria-label="选择 OpenTrad 项目文件"
          onChange={(event) => onImportSelection(event.target.files?.[0])}
        />
      </fieldset>

      {openPanel === "profiles" && (
        <div className="modal-backdrop">
          <section
            className="manager-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={profilesTitleId}
            aria-busy={busyAction !== null}
          >
            <header>
              <div>
                <Building2 size={18} />
                <h2 id={profilesTitleId}>公司档案</h2>
              </div>
              <button
                ref={dialogCloseRef}
                type="button"
                className="dialog-close"
                aria-label="关闭公司档案"
                disabled={busyAction !== null}
                onClick={closePanel}
              >
                <X size={18} />
              </button>
            </header>
            <p>把当前报价方信息保存为本机档案，之后可一键带入。</p>
            <div className="profile-save-row">
              <label>
                <span>档案名称</span>
                <input
                  value={profileLabel}
                  disabled={busyAction !== null}
                  onChange={(event) => setProfileLabel(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={busyAction !== null}
                onClick={() =>
                  void runImmediateAction("save-profile", () =>
                    workspace.saveSellerProfile(profileLabel),
                  )
                }
              >
                保存当前报价方
              </button>
            </div>
            <ul className="manager-list">
              {workspace.companyProfiles.length === 0 && (
                <li className="manager-empty">还没有公司档案</li>
              )}
              {workspace.companyProfiles.map((profile) => (
                <li key={profile.id}>
                  <div className="manager-list-copy">
                    <strong>{profile.label}</strong>
                    <small>{profile.party.name}</small>
                  </div>
                  <div className="manager-list-actions">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => workspace.applyCompanyProfile(profile.id)}
                    >
                      应用{profile.label}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busyAction !== null}
                      onClick={(event) =>
                        openConfirmation(
                          { kind: "delete-profile", id: profile.id },
                          event.currentTarget,
                        )
                      }
                    >
                      删除{profile.label}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {openPanel === "drafts" && (
        <div className="modal-backdrop">
          <section
            className="manager-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={draftsTitleId}
            aria-busy={busyAction !== null}
          >
            <header>
              <div>
                <FileArchive size={18} />
                <h2 id={draftsTitleId}>草稿管理</h2>
              </div>
              <button
                ref={dialogCloseRef}
                type="button"
                className="dialog-close"
                aria-label="关闭草稿管理"
                disabled={busyAction !== null}
                onClick={closePanel}
              >
                <X size={18} />
              </button>
            </header>
            <div className="dialog-primary-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busyAction !== null}
                onClick={() =>
                  void runImmediateAction("new-draft", () => workspace.createNewDraft())
                }
              >
                新建草稿
              </button>
              <button
                type="button"
                className="secondary-button danger-button"
                disabled={busyAction !== null}
                onClick={(event) => openConfirmation({ kind: "clear-all" }, event.currentTarget)}
              >
                清空全部本机数据
              </button>
            </div>
            <ul className="manager-list draft-list">
              {workspace.savedDrafts.length === 0 && (
                <li className="manager-empty">还没有已保存的报价草稿</li>
              )}
              {workspace.savedDrafts.map((entry) => (
                <li
                  key={entry.id}
                  className={entry.id === workspace.form?.id ? "current" : undefined}
                >
                  <div className="manager-list-copy">
                    <strong>{entry.draft.meta.number}</strong>
                    <small>
                      {entry.draft.buyer.name} · {new Date(entry.savedAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  <div className="manager-list-actions">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void runImmediateAction(`load-draft:${entry.id}`, () =>
                          workspace.loadDraft(entry.id),
                        )
                      }
                    >
                      载入草稿：{entry.draft.meta.number}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busyAction !== null}
                      onClick={(event) =>
                        openConfirmation(
                          { kind: "delete-draft", id: entry.id },
                          event.currentTarget,
                        )
                      }
                    >
                      删除草稿：{entry.draft.meta.number}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {confirmation?.kind === "delete-profile" && (
        <ConfirmationDialog
          titleId="delete-profile-title"
          title="确认删除公司档案"
          description="删除后不会影响已填写的报价单，但该本机档案无法恢复。"
          confirmLabel="确认删除"
          busy={busyAction !== null}
          cancelRef={confirmationCancelRef}
          onCancel={() => closeConfirmation()}
          onConfirm={() => void runConfirmation()}
        />
      )}
      {confirmation?.kind === "delete-draft" && (
        <ConfirmationDialog
          titleId="delete-draft-title"
          title="确认删除草稿"
          description="删除后无法从本机恢复，请确认已导出所需文件。"
          confirmLabel="确认删除"
          busy={busyAction !== null}
          cancelRef={confirmationCancelRef}
          onCancel={() => closeConfirmation()}
          onConfirm={() => void runConfirmation()}
        />
      )}
      {confirmation?.kind === "clear-all" && (
        <ConfirmationDialog
          titleId="clear-all-title"
          title="确认清空本机数据"
          description="公司档案和所有报价草稿都会被清除，此操作不可撤销。"
          confirmLabel="确认清空"
          busy={busyAction !== null}
          cancelRef={confirmationCancelRef}
          onCancel={() => closeConfirmation()}
          onConfirm={() => void runConfirmation()}
        />
      )}
      {confirmation?.kind === "import" && (
        <ConfirmationDialog
          titleId="import-title"
          title="确认导入项目"
          description="当前草稿不会被覆盖；项目会复制为新的本机草稿并切换到该副本。"
          confirmLabel="作为新草稿副本导入"
          primary
          busy={busyAction !== null}
          cancelRef={confirmationCancelRef}
          onCancel={() => closeConfirmation()}
          onConfirm={() => void runConfirmation()}
        />
      )}
      <div className="manager-live" aria-live="polite">
        {localMessage || workspace.operationMessage}
      </div>
    </>
  );
}

function ConfirmationDialog({
  titleId,
  title,
  description,
  confirmLabel,
  primary = false,
  busy,
  cancelRef,
  onCancel,
  onConfirm,
}: {
  titleId: string;
  title: string;
  description: string;
  confirmLabel: string;
  primary?: boolean;
  busy: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm-layer">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className="confirm-dialog"
      >
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div>
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={primary ? "primary-button" : "danger-button"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
