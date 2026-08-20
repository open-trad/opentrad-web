import { v2 } from "@opentrad/document-core";
import {
  ArrowLeft,
  Check,
  Eye,
  FilePenLine,
  HardDrive,
  Layers3,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type ImportedProjectV2,
  importProjectV2Zip,
  PROJECT_V2_ZIP_MIME,
  type ProjectV2AttachmentFile,
} from "../project/projectV2Files";
import { MAX_PROJECT_ZIP_BYTES } from "../project/zipPreflight";
import { prepareAttachmentAddition, prepareAttachmentRemoval } from "./attachments";
import { BidPreflightPanel, resolveBidExportDecision } from "./BidPreflightPanel";
import { DocumentPreviewPanel } from "./DocumentPreviewPanel";
import { ExportPanel } from "./ExportPanel";
import { getDraftField } from "./fieldPaths";
import { type FormIssue, SchemaForm } from "./SchemaForm";
import { type DocumentWorkspaceOptions, useDocumentWorkspace } from "./useDocumentWorkspace";

type Registration = ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get>;
type AttachmentField = Extract<
  v2.TemplateFieldManifestEntryV1 | v2.TemplateRepeatableItemFieldV1,
  { control: "attachment" }
>;

const LANGUAGE_LABELS: Readonly<Record<v2.DocumentLanguageV2, string>> = {
  "zh-CN": "中文",
  "en-US": "英文",
  "zh-en": "中英双语",
};

const SECTION_LABELS: Readonly<Record<string, string>> = {
  "delivery-installation": "交付与安装",
  "training-acceptance": "培训与验收",
  "warranty-aftersales": "质保与售后",
};

function sectionLabel(registration: Registration, section: string): string {
  const explicit = SECTION_LABELS[section];
  if (explicit) return explicit;
  const firstField = registration.definition.fieldManifest.find(
    (field) => field.section === section,
  );
  if (firstField && /\p{Script=Han}/u.test(firstField.label)) return firstField.label;
  return "文书章节";
}

function importErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message.length > 0 && message.length <= 120 && /\p{Script=Han}/u.test(message)
    ? message
    : "项目 ZIP 无效，请确认文件来自 OpenTrad 后重试";
}

interface PendingAttachment {
  readonly field: AttachmentField;
  readonly path: string;
  readonly file: File;
}

function useMobileEditor(): boolean {
  const query = "(max-width: 599px)";
  const [mobile, setMobile] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setMobile(event.matches);
    setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function attachmentReference(
  registration: Registration,
  draft: unknown,
  attachmentId: string,
): { readonly field: AttachmentField; readonly path: string } | null {
  for (const field of registration.definition.fieldManifest) {
    if (field.control === "attachment") {
      const value = getDraftField(draft, field.path);
      if (value === attachmentId || (Array.isArray(value) && value.includes(attachmentId))) {
        return { field, path: field.path };
      }
    }
    if (field.control !== "repeatable" || field.item.kind !== "object") continue;
    const rows = getDraftField(draft, field.path);
    if (!Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      for (const itemField of field.item.fields) {
        if (itemField.control !== "attachment") continue;
        const value = getDraftField(row, itemField.path);
        if (value === attachmentId || (Array.isArray(value) && value.includes(attachmentId))) {
          return { field: itemField, path: `${field.path}.${index}.${itemField.path}` };
        }
      }
    }
  }
  return null;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("附件读取失败"));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(new Uint8Array(reader.result))
        : reject(new Error("附件读取失败"));
    reader.readAsArrayBuffer(blob);
  });
}

function AttachmentConfirmation({
  pending,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  readonly pending: PendingAttachment;
  readonly busy: boolean;
  readonly error: string;
  readonly onCancel: () => void;
  readonly onConfirm: (pageCount: number, confirmed: boolean) => void;
}) {
  const isPdf = pending.file.type === "application/pdf";
  const [pageCount, setPageCount] = useState(isPdf ? "" : "1");
  const [confirmed, setConfirmed] = useState(!isPdf);
  const validPageCount = /^\d+$/u.test(pageCount) && Number(pageCount) >= 1;
  return (
    <section className="document-editor-v2__attachment-confirm" aria-label="确认附件信息">
      <div>
        <Upload aria-hidden="true" />
        <div>
          <strong>{pending.file.name}</strong>
          <span>{pending.field.label}</span>
        </div>
      </div>
      {isPdf ? (
        <>
          <label>
            PDF 页数（请人工确认）
            <input
              type="number"
              min="1"
              max="10000"
              value={pageCount}
              onChange={(event) => setPageCount(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我已人工核对 PDF 页数；OpenTrad 不会自动解析页数
          </label>
        </>
      ) : (
        <p>图片附件按 1 页登记。</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          disabled={busy || !validPageCount || !confirmed}
          onClick={() => onConfirm(Number(pageCount), confirmed)}
        >
          <Check aria-hidden="true" /> 附加到本机文书
        </button>
      </div>
    </section>
  );
}

export interface DocumentEditorPageProps {
  readonly workspaceOptions?: Omit<DocumentWorkspaceOptions, "registration">;
}

function EditorWorkspace({
  registration,
  workspaceOptions,
}: {
  readonly registration: Registration;
  readonly workspaceOptions?: Omit<DocumentWorkspaceOptions, "registration">;
}) {
  const workspace = useDocumentWorkspace({ ...workspaceOptions, registration });
  const [mobileView, setMobileView] = useState<"form" | "preview">("form");
  const [pendingAttachments, setPendingAttachments] = useState<readonly PendingAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [exportAttachments, setExportAttachments] = useState<readonly ProjectV2AttachmentFile[]>(
    [],
  );
  const [pendingImport, setPendingImport] = useState<ImportedProjectV2 | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const importConfirmRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const fillTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);
  const focusDestinationRef = useRef<"panel" | "tab" | null>(null);
  const fillTabId = useId();
  const previewTabId = useId();
  const fillPanelId = useId();
  const previewPanelId = useId();
  const isMobile = useMobileEditor();

  useEffect(() => {
    const destination = focusDestinationRef.current;
    if (!destination) return;
    focusDestinationRef.current = null;
    if (destination === "panel") {
      (mobileView === "preview" ? previewRef.current : formRef.current)?.focus();
    } else {
      (mobileView === "preview" ? previewTabRef.current : fillTabRef.current)?.focus();
    }
  }, [mobileView]);

  useEffect(() => {
    let active = true;
    void Promise.all(
      workspace.attachmentRecords.map(async (record) => ({
        id: record.attachmentId,
        mediaType: record.mediaType,
        pageCount: record.pageCount,
        bytes: await blobBytes(record.blob),
      })),
    )
      .then((files) => {
        if (active) setExportAttachments(files);
      })
      .catch(() => {
        if (active) {
          setExportAttachments([]);
          setAttachmentError("本机附件读取失败，项目 ZIP 暂不可用");
        }
      });
    return () => {
      active = false;
    };
  }, [workspace.attachmentRecords]);

  useEffect(() => {
    if (pendingImport) importConfirmRef.current?.focus();
  }, [pendingImport]);

  useEffect(() => {
    if (importError && !importBusy) importInputRef.current?.focus();
  }, [importBusy, importError]);

  if (workspace.loading) {
    return (
      <div className="document-editor-v2__loading" aria-busy="true">
        正在读取本机文书…
      </div>
    );
  }
  if (workspace.loadError || !workspace.envelope || !workspace.snapshot) {
    return (
      <section className="document-editor-v2__fatal" role="alert">
        <h1>无法打开文书编辑器</h1>
        <p>{workspace.loadError ?? "本机文书状态无效，请刷新后重试"}</p>
      </section>
    );
  }

  const { definition } = registration;
  const currentEnvelope = workspace.envelope;
  const currentSnapshot = workspace.snapshot;
  const attachedDescriptors = currentEnvelope.attachmentManifest.filter(
    (attachment) => attachment.status === "attached",
  );
  const exportAttachmentById = new Map(
    exportAttachments.map((attachment) => [attachment.id, attachment]),
  );
  const projectAttachmentsReady =
    attachedDescriptors.length === exportAttachments.length &&
    attachedDescriptors.every((descriptor) => {
      const file = exportAttachmentById.get(descriptor.id);
      return file?.mediaType === descriptor.mediaType && file.pageCount === descriptor.pageCount;
    });
  const sections = [...new Set(definition.fieldManifest.map((field) => field.section))];
  const activePending = pendingAttachments[0];
  const stale = workspace.autosaveStatus === "invalid";
  const decision =
    currentSnapshot.model.documentKind === "bid"
      ? resolveBidExportDecision(currentSnapshot, workspaceOptions?.trustedAsOf)
      : null;

  const selectView = (view: "form" | "preview", destination: "panel" | "tab" = "panel") => {
    if (view === mobileView) {
      if (destination === "panel") {
        (view === "preview" ? previewRef.current : formRef.current)?.focus();
      } else {
        (view === "preview" ? previewTabRef.current : fillTabRef.current)?.focus();
      }
      return;
    }
    focusDestinationRef.current = destination;
    setMobileView(view);
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    let view: "form" | "preview" | undefined;
    if (event.key === "ArrowRight" || event.key === "End") view = "preview";
    if (event.key === "ArrowLeft" || event.key === "Home") view = "form";
    if (!view) return;
    event.preventDefault();
    selectView(view, "tab");
  };

  const confirmAttachment = async (pageCount: number, confirmed: boolean) => {
    if (!activePending) return;
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const transaction = await prepareAttachmentAddition({
        registration,
        envelope: currentEnvelope,
        field: activePending.field,
        path: activePending.path,
        attachmentId: `attachment-${crypto.randomUUID()}`,
        displayName: activePending.file.name,
        blob: activePending.file,
        pageCount,
        pageCountConfirmed: confirmed,
        documentKind: currentSnapshot.model.documentKind,
        savedAt: workspaceOptions?.now?.() ?? new Date().toISOString(),
        existingRecords: workspace.attachmentRecords,
      });
      workspace.applyAttachmentTransaction(transaction);
      setPendingAttachments((current) => current.slice(1));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "附件处理失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    const reference = attachmentReference(registration, currentEnvelope.draft, attachmentId);
    if (!reference) {
      setAttachmentError("附件引用无法安全定位，未执行删除");
      return;
    }
    try {
      workspace.applyAttachmentTransaction(
        prepareAttachmentRemoval({
          registration,
          envelope: currentEnvelope,
          field: reference.field,
          path: reference.path,
          attachmentId,
        }),
      );
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "附件删除失败");
    }
  };

  const parseImport = async (file: File) => {
    setImportBusy(true);
    setImportError("");
    setPendingImport(null);
    try {
      if (file.size > MAX_PROJECT_ZIP_BYTES) throw new Error("项目包超过 52 MiB");
      const imported = await importProjectV2Zip(file, { registry: v2.V2_TEMPLATE_REGISTRY });
      if (
        imported.envelope.template.id !== definition.id ||
        imported.envelope.template.version !== definition.version
      ) {
        throw new Error("项目包模板或版本与当前编辑器不一致，请在对应模板编辑器中导入");
      }
      setPendingImport(imported);
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setImportBusy(false);
    }
  };

  const cancelImport = () => {
    setPendingImport(null);
    importInputRef.current?.focus();
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    setImportError("");
    try {
      await workspace.importConfirmedProject(pendingImport, true);
      setPendingImport(null);
      importInputRef.current?.focus();
    } catch (error) {
      setImportError(importErrorMessage(error));
      importConfirmRef.current?.focus();
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="document-editor-v2" data-mobile-view={mobileView}>
      <header className="document-editor-v2__topbar">
        <div>
          <span className="eyebrow">本地文书工作台</span>
          <h1>{definition.name}</h1>
          <p>
            {definition.id} · {definition.version}
          </p>
        </div>
        <div className="document-editor-v2__top-actions">
          <label>
            版式
            <select
              aria-label="文书版式"
              value={currentEnvelope.presentation.layoutStyleId}
              onChange={(event) =>
                workspace.updatePresentation({
                  languageView: currentEnvelope.presentation.languageView,
                  layoutStyleId: event.target.value as v2.LayoutStyleId,
                })
              }
            >
              {definition.allowedLayouts.map((layout) => (
                <option value={layout} key={layout}>
                  {v2.getPresentationProfile(layout).label}
                </option>
              ))}
            </select>
          </label>
          <label>
            语言
            <select
              aria-label="文书语言"
              value={currentEnvelope.presentation.languageView}
              onChange={(event) =>
                workspace.updatePresentation({
                  layoutStyleId: currentEnvelope.presentation.layoutStyleId,
                  languageView: event.target.value as v2.DocumentLanguageV2,
                })
              }
            >
              {definition.languages.map((language) => (
                <option value={language} key={language}>
                  {LANGUAGE_LABELS[language]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void workspace.flush()}>
            <Save aria-hidden="true" /> 立即保存
          </button>
          <label className="document-editor-v2__import-action">
            <Upload aria-hidden="true" />
            <span>{importBusy ? "正在读取项目…" : "导入本地项目 ZIP"}</span>
            <input
              ref={importInputRef}
              type="file"
              aria-label="导入本地项目 ZIP"
              accept={`.opentrad,.zip,${PROJECT_V2_ZIP_MIME}`}
              disabled={importBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void parseImport(file);
              }}
            />
          </label>
        </div>
      </header>

      <div className="document-editor-v2__local-strip">
        <HardDrive aria-hidden="true" />
        <span>所有文书内容仅保存在当前设备</span>
        <output aria-live="polite">
          {workspace.autosaveStatus === "idle" ? "" : workspace.statusMessage}
        </output>
        {workspace.autosaveStatus === "conflict" ? (
          <button type="button" onClick={() => void workspace.reload()}>
            重新载入
          </button>
        ) : null}
      </div>

      {importError ? (
        <p className="document-editor-v2__import-error" role="alert">
          {importError}
        </p>
      ) : null}

      {pendingImport ? (
        <div className="document-editor-v2__import-backdrop">
          <section
            className="document-editor-v2__import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="确认导入本地项目"
          >
            <span className="eyebrow">本机项目预检</span>
            <h2>确认导入本地项目</h2>
            <dl>
              <div>
                <dt>模板与版本</dt>
                <dd>
                  {pendingImport.envelope.template.id}@{pendingImport.envelope.template.version}
                </dd>
              </div>
              <div>
                <dt>附件</dt>
                <dd>{pendingImport.attachments.length} 个附件</dd>
              </div>
            </dl>
            <ul className="document-editor-v2__import-warnings">
              <li>只有点击“确认并导入”后，项目与附件才会原子写入本机存储。</li>
              <li>导入将切换到项目包中的文书；请先确认当前编辑已保存。</li>
              {pendingImport.attachments.length > 0 ? (
                <li>附件页数来自项目包，请在对外使用前人工复核。</li>
              ) : null}
            </ul>
            <div>
              <button type="button" disabled={importBusy} onClick={cancelImport}>
                取消导入
              </button>
              <button
                ref={importConfirmRef}
                type="button"
                disabled={importBusy}
                onClick={() => void confirmImport()}
              >
                <Check aria-hidden="true" /> 确认并导入
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isMobile ? (
        <div className="document-editor-v2__tabs" role="tablist" aria-label="编辑视图">
          <button
            ref={fillTabRef}
            id={fillTabId}
            type="button"
            role="tab"
            aria-controls={fillPanelId}
            aria-selected={mobileView === "form"}
            tabIndex={mobileView === "form" ? 0 : -1}
            onKeyDown={handleTabKey}
            onClick={() => selectView("form")}
          >
            <FilePenLine aria-hidden="true" /> 填写
          </button>
          <button
            ref={previewTabRef}
            id={previewTabId}
            type="button"
            role="tab"
            aria-controls={previewPanelId}
            aria-selected={mobileView === "preview"}
            tabIndex={mobileView === "preview" ? 0 : -1}
            onKeyDown={handleTabKey}
            onClick={() => selectView("preview")}
          >
            <Eye aria-hidden="true" /> 预览
          </button>
        </div>
      ) : null}

      <div className="document-editor-v2__workspace">
        <aside className="document-editor-v2__steps" aria-label="文书章节">
          <div>
            <Layers3 aria-hidden="true" />
            <span>填写章节</span>
          </div>
          <ol>
            {sections.map((section, index) => {
              return (
                <li key={section}>
                  <button
                    type="button"
                    onClick={() => {
                      formRef.current
                        ?.querySelector<HTMLElement>(`[data-section="${section}"]`)
                        ?.scrollIntoView({ block: "start" });
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>{sectionLabel(registration, section)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section
          ref={formRef}
          id={isMobile ? fillPanelId : undefined}
          role={isMobile ? "tabpanel" : undefined}
          aria-labelledby={isMobile ? fillTabId : undefined}
          hidden={isMobile && mobileView !== "form"}
          className="document-editor-v2__form"
          aria-label="文书填写区"
          tabIndex={-1}
        >
          <div className="document-editor-v2__form-intro">
            <div>
              <span>结构化填写</span>
              <h2>按模板字段完成文书</h2>
            </div>
            <p>{definition.summary}</p>
          </div>
          <SchemaForm
            key={workspace.hydrationKey}
            registration={registration}
            draft={currentEnvelope.draft}
            issues={workspace.validationIssues as readonly FormIssue[]}
            onDraftChange={workspace.acceptParsedDraft}
            onValidationChange={workspace.reportValidationIssues}
            onAttachmentFiles={(field, path, files) => {
              const queued = Array.from(files).map((file) => ({ field, path, file }));
              setPendingAttachments((current) => [...current, ...queued]);
            }}
          />
          {activePending ? (
            <AttachmentConfirmation
              key={`${activePending.path}-${activePending.file.name}`}
              pending={activePending}
              busy={attachmentBusy}
              error={attachmentError}
              onCancel={() => setPendingAttachments((current) => current.slice(1))}
              onConfirm={(pageCount, confirmed) => void confirmAttachment(pageCount, confirmed)}
            />
          ) : null}
          {currentEnvelope.attachmentManifest.length > 0 ? (
            <section className="document-editor-v2__attachment-list" aria-label="本机附件">
              <h2>本机附件</h2>
              <ul>
                {currentEnvelope.attachmentManifest.map((attachment) => (
                  <li key={attachment.id}>
                    <div>
                      <strong>{attachment.displayName}</strong>
                      <span>{attachment.pageCount} 页</span>
                    </div>
                    <button type="button" onClick={() => removeAttachment(attachment.id)}>
                      <Trash2 aria-hidden="true" /> 删除附件
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {attachmentError && !activePending ? <p role="alert">{attachmentError}</p> : null}
          {decision ? <BidPreflightPanel snapshot={currentSnapshot} decision={decision} /> : null}
          <ExportPanel
            snapshot={currentSnapshot}
            attachments={exportAttachments}
            projectAttachmentsReady={projectAttachmentsReady}
            trustedAsOf={workspaceOptions?.trustedAsOf}
          />
        </section>

        <div className="document-editor-v2__preview-column">
          <div className="document-editor-v2__preview-toolbar">
            <span>
              <ShieldCheck aria-hidden="true" /> 有效快照
            </span>
            <span>A4 · 局部滚动</span>
          </div>
          <DocumentPreviewPanel
            panelRef={previewRef}
            snapshot={currentSnapshot}
            stale={stale}
            tabPanel={
              isMobile
                ? {
                    id: previewPanelId,
                    labelledBy: previewTabId,
                    hidden: mobileView !== "preview",
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

export function DocumentEditorPage({ workspaceOptions }: DocumentEditorPageProps = {}) {
  const { templateId = "" } = useParams();
  let registration: Registration;
  try {
    registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
  } catch {
    return (
      <main className="document-editor-v2__unknown">
        <span className="eyebrow">无法解析模板</span>
        <h1>模板版本不存在</h1>
        <p>未找到 {templateId || "（空模板编号）"}@1.0.0，本机不会猜测或回退到其他模板。</p>
        <Link to="/templates">
          <ArrowLeft aria-hidden="true" /> 返回模板中心
        </Link>
      </main>
    );
  }
  return <EditorWorkspace registration={registration} workspaceOptions={workspaceOptions} />;
}
