import { v2 } from "@opentrad/document-core";
import { Download, FileArchive, FileJson, FileText } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { buildDownloadFilename, downloadBlob } from "../../quotation/export/download";
import { exportProjectV2Zip, type ProjectV2AttachmentFile } from "../project/projectV2Files";
import { renderDocxV2 } from "../render/docx/renderDocxV2";
import { renderPdfV2 } from "../render/pdf/renderPdfV2";
import { resolveBidExportDecision } from "./BidPreflightPanel";
import type { DocumentRevisionSnapshot } from "./useDocumentWorkspace";

export interface ExportPanelServices {
  readonly renderDocx: typeof renderDocxV2;
  readonly renderPdf: typeof renderPdfV2;
  readonly exportProject: typeof exportProjectV2Zip;
  readonly download: typeof downloadBlob;
}

const DEFAULT_SERVICES: ExportPanelServices = {
  renderDocx: renderDocxV2,
  renderPdf: renderPdfV2,
  exportProject: exportProjectV2Zip,
  download: downloadBlob,
};

type ExportAction = "docx" | "pdf" | "json" | "opentrad" | "submission-pdf";

function bidModeLabel(mode: v2.BidExportModeV1): string {
  return mode === "internal-draft" ? "内部底稿" : mode === "review-copy" ? "审核稿" : "提交版";
}

export function ExportPanel({
  snapshot,
  attachments,
  projectAttachmentsReady = true,
  trustedAsOf,
  services = DEFAULT_SERVICES,
}: {
  readonly snapshot: DocumentRevisionSnapshot;
  readonly attachments: readonly ProjectV2AttachmentFile[];
  readonly projectAttachmentsReady?: boolean;
  readonly trustedAsOf?: string;
  readonly services?: ExportPanelServices;
}) {
  const titleId = useId();
  const submissionReasonId = useId();
  const projectReasonId = useId();
  const [busy, setBusy] = useState<ExportAction | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const decision = useMemo(
    () =>
      snapshot.model.documentKind === "bid"
        ? resolveBidExportDecision(snapshot, trustedAsOf)
        : null,
    [snapshot, trustedAsOf],
  );
  const modeLabel = decision ? bidModeLabel(decision.mode) : "";
  const basename = `${snapshot.model.title.zhCN}-${snapshot.model.documentId}${
    modeLabel ? `-${modeLabel}` : ""
  }`;
  const wordLabel = decision ? `下载${modeLabel} Word` : "下载 Word";
  const pdfLabel = decision ? `下载${modeLabel} PDF` : "下载 PDF";

  async function exportFile(action: ExportAction): Promise<void> {
    if (busy) return;
    setBusy(action);
    setErrorMessage("");
    try {
      const { layoutStyleId, languageView } = snapshot.envelope.presentation;
      if (action === "docx") {
        services.download(
          await services.renderDocx(snapshot.model, layoutStyleId, languageView),
          buildDownloadFilename(basename, "docx"),
        );
      } else if (action === "pdf" || action === "submission-pdf") {
        services.download(
          await services.renderPdf(snapshot.model, layoutStyleId, languageView),
          buildDownloadFilename(basename, "pdf"),
        );
      } else if (action === "json") {
        services.download(
          new Blob([JSON.stringify(snapshot.model)], { type: "application/json" }),
          buildDownloadFilename(basename, "json"),
        );
      } else {
        services.download(
          await services.exportProject({
            envelope: snapshot.envelope,
            attachments,
            registry: v2.V2_TEMPLATE_REGISTRY,
          }),
          buildDownloadFilename(basename, "opentrad"),
        );
      }
    } catch {
      setErrorMessage("导出失败，请检查文书内容后重试");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  return (
    <section className="document-editor-v2__exports" aria-labelledby={titleId}>
      <div>
        <span>同一有效快照</span>
        <h2 id={titleId}>本机导出</h2>
      </div>
      <p>Word、PDF 与 JSON 均来自当前预览所用的同一份文书模型，不上传任何内容。</p>
      <div className="document-editor-v2__export-actions">
        <button type="button" disabled={disabled} onClick={() => void exportFile("docx")}>
          <FileText aria-hidden="true" />
          {wordLabel}
        </button>
        <button type="button" disabled={disabled} onClick={() => void exportFile("pdf")}>
          <Download aria-hidden="true" />
          {pdfLabel}
        </button>
        <button type="button" disabled={disabled} onClick={() => void exportFile("json")}>
          <FileJson aria-hidden="true" />
          下载 JSON
        </button>
        <button
          type="button"
          disabled={disabled || !projectAttachmentsReady}
          aria-describedby={!projectAttachmentsReady ? projectReasonId : undefined}
          onClick={() => void exportFile("opentrad")}
        >
          <FileArchive aria-hidden="true" />
          导出本地项目 ZIP
        </button>
        {decision && !decision.canExportSubmission ? (
          <button type="button" disabled aria-describedby={submissionReasonId}>
            <Download aria-hidden="true" />
            下载提交版 PDF
          </button>
        ) : null}
      </div>
      {decision && !decision.canExportSubmission ? (
        <p id={submissionReasonId}>完成来源绑定与全部阻断项复核后才可导出提交版。</p>
      ) : null}
      {!projectAttachmentsReady ? (
        <p id={projectReasonId}>正在同步本机附件，项目 ZIP 暂不可用。</p>
      ) : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </section>
  );
}
