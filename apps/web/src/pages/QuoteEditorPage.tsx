import { ArrowLeft, ChevronLeft, ChevronRight, Eye, PanelRight, Save } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BuyerStep } from "../features/quotation/editor/BuyerStep";
import { DocumentModelPreview } from "../features/quotation/editor/DocumentModelPreview";
import {
  defaultQuotationExportDependencies,
  exportQuotation,
  type QuotationExportDependencies,
  QuotationExportError,
  type QuotationExportFormat,
} from "../features/quotation/editor/exportQuotation";
import { LineItemsStep } from "../features/quotation/editor/LineItemsStep";
import { MetaStep } from "../features/quotation/editor/MetaStep";
import { ReviewStep } from "../features/quotation/editor/ReviewStep";
import { QUOTATION_STEPS, StepNavigation } from "../features/quotation/editor/StepNavigation";
import { TermsStep } from "../features/quotation/editor/TermsStep";
import {
  type QuotationWorkspaceOptions,
  useQuotationWorkspace,
} from "../features/quotation/editor/useQuotationWorkspace";
import { WorkspaceManagers } from "../features/quotation/editor/WorkspaceManagers";

const mobileEditorQuery = "(max-width: 600px)";

function useIsMobileEditor() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(mobileEditorQuery).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(mobileEditorQuery);
    const updateViewport = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);
  return isMobile;
}

const stepDescriptions = [
  "填写报价元数据与报价方资料。",
  "填写采购方的完整联系与结算资料。",
  "录入商品、数量、单价、折扣和税率。",
  "补充交货、付款、检验、质保及备注。",
  "核对风险提示并生成本地文件。",
] as const;

function firstInvalidStep(errors: Record<string, string>) {
  return Math.min(
    ...Object.keys(errors).map((path) => {
      if (path.startsWith("buyer.")) return 1;
      if (path.startsWith("lineItems.")) return 2;
      if (path.startsWith("terms.")) return 3;
      return 0;
    }),
  );
}

export interface QuoteEditorPageProps {
  workspaceOptions?: QuotationWorkspaceOptions;
  createLineId?: () => string;
  exportDependencies?: QuotationExportDependencies;
}

export function QuoteEditorPage({
  workspaceOptions,
  createLineId = () => crypto.randomUUID(),
  exportDependencies = defaultQuotationExportDependencies,
}: QuoteEditorPageProps = {}) {
  const workspace = useQuotationWorkspace(workspaceOptions);
  const [activeStep, setActiveStep] = useState(0);
  const [mobileView, setMobileView] = useState<"form" | "preview">("form");
  const [busyExport, setBusyExport] = useState<QuotationExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const isMobileEditor = useIsMobileEditor();
  const formRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const hasSwitchedView = useRef(false);
  const hasMovedStep = useRef(false);
  const focusErrorAfterStepChange = useRef(false);

  useEffect(() => {
    if (!hasMovedStep.current || activeStep < 0) return;
    if (focusErrorAfterStepChange.current) {
      focusErrorAfterStepChange.current = false;
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else {
      formRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
    }
  }, [activeStep]);

  useEffect(() => {
    if (!hasSwitchedView.current) return;
    (mobileView === "preview" ? previewRef.current : formRef.current)?.focus();
  }, [mobileView]);

  const focusFirstError = () => {
    queueMicrotask(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  };

  const goToStep = (target: number) => {
    if (target === activeStep) return;
    let destination = target;
    if (target > activeStep) {
      const validation = workspace.validate();
      if (!validation.ok) {
        const invalidStep = firstInvalidStep(validation.errors);
        destination = Math.min(target, invalidStep);
        if (destination === invalidStep) {
          if (destination === activeStep) {
            focusFirstError();
            return;
          }
          focusErrorAfterStepChange.current = true;
        }
      }
    }
    hasMovedStep.current = true;
    setActiveStep(destination);
  };

  const toggleMobileView = () => {
    hasSwitchedView.current = true;
    setMobileView((current) => (current === "form" ? "preview" : "form"));
  };

  const handleExport = async (format: QuotationExportFormat) => {
    if (workspace.previewStale || !workspace.lastValidDraft || busyExport) return;
    setBusyExport(format);
    setExportStatus(`正在生成 ${format.toUpperCase()} 文件…`);
    const saved = await workspace.saveNow();
    if (!saved) {
      setBusyExport(null);
      setExportStatus("草稿保存失败，未开始导出");
      return;
    }
    try {
      await exportQuotation(format, workspace.lastValidDraft, exportDependencies);
      setExportStatus(`${format.toUpperCase()} 导出成功，文件已保存到下载目录`);
    } catch (error) {
      setExportStatus(
        error instanceof QuotationExportError
          ? error.message
          : "文件生成失败，请检查报价内容后重试",
      );
    } finally {
      setBusyExport(null);
    }
  };

  if (workspace.loading) {
    return (
      <main className="editor-loading" aria-busy="true">
        正在读取本机草稿…
      </main>
    );
  }
  if (
    workspace.loadError ||
    !workspace.form ||
    !workspace.previewModel ||
    !workspace.lastValidDraft
  ) {
    return (
      <main className="editor-error" role="alert">
        <h1>无法打开报价单编辑器</h1>
        <p>{workspace.loadError ?? "本机草稿状态无效，请刷新后重试"}</p>
      </main>
    );
  }

  const form = workspace.form;
  const update = (next: typeof form) => workspace.updateForm(() => next);
  let stepContent: ReactNode;
  switch (activeStep) {
    case 0:
      stepContent = <MetaStep form={form} errors={workspace.validationErrors} onChange={update} />;
      break;
    case 1:
      stepContent = <BuyerStep form={form} errors={workspace.validationErrors} onChange={update} />;
      break;
    case 2:
      stepContent = (
        <LineItemsStep
          form={form}
          errors={workspace.validationErrors}
          validDraft={workspace.lastValidDraft}
          createLineId={createLineId}
          onChange={update}
        />
      );
      break;
    case 3:
      stepContent = <TermsStep form={form} onChange={update} />;
      break;
    case 4:
      stepContent = (
        <ReviewStep
          form={form}
          busy={busyExport}
          disabled={workspace.previewStale}
          exportStatus={exportStatus}
          onExport={(format) => void handleExport(format)}
        />
      );
      break;
    default:
      stepContent = null;
  }

  return (
    <div className="editor-page" data-mobile-view={mobileView}>
      <div className="editor-topbar">
        <div>
          <span className="eyebrow">报价单编辑器</span>
          <h1>标准商品报价单</h1>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void workspace.saveNow()}
          >
            <Save size={16} /> 保存草稿
          </button>
          {isMobileEditor && (
            <button
              type="button"
              className="primary-button mobile-view-toggle"
              aria-pressed={mobileView === "preview"}
              onClick={toggleMobileView}
            >
              {mobileView === "preview" ? (
                <>
                  <ArrowLeft size={16} /> 返回填写
                </>
              ) : (
                <>
                  <Eye size={16} /> 查看文档预览
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <WorkspaceManagers workspace={workspace} />
      <div className="local-only-strip">所有草稿与文件仅保存在当前设备，不会自动上传。</div>
      <output className="storage-health-live" aria-label="本机存储状态">
        {workspace.storageHealthMessage}
      </output>
      <div className="editor-workspace">
        <StepNavigation activeStep={activeStep} onSelect={goToStep} />
        <section ref={formRef} className="quote-form" aria-label="报价单填写区" tabIndex={-1}>
          <div className="form-section-heading">
            <span>{String(activeStep + 1).padStart(2, "0")}</span>
            <div>
              <h2 tabIndex={-1} data-step-heading>
                {QUOTATION_STEPS[activeStep]}
              </h2>
              <p>{stepDescriptions[activeStep]}</p>
            </div>
          </div>
          <form onSubmit={(event) => event.preventDefault()}>{stepContent}</form>
          <div className="form-footer">
            <span aria-live="polite">{workspace.statusMessage}</span>
            <div className="step-actions">
              {activeStep > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => goToStep(activeStep - 1)}
                >
                  <ChevronLeft size={16} /> 上一步
                </button>
              )}
              {activeStep < QUOTATION_STEPS.length - 1 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => goToStep(activeStep + 1)}
                >
                  下一步 <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        </section>
        <section
          ref={previewRef}
          className="preview-panel"
          aria-label="A4 报价单预览"
          tabIndex={-1}
        >
          <div className="preview-toolbar">
            <span>
              <PanelRight size={16} /> 文档预览
            </span>
            <span>A4 · 100%</span>
          </div>
          {workspace.previewStale && <output className="preview-stale">预览等待修正后更新</output>}
          <DocumentModelPreview model={workspace.previewModel} />
        </section>
      </div>
    </div>
  );
}
