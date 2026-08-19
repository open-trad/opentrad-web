import type { StandardGoodsQuoteDraft } from "@opentrad/document-core";
import { renderDocxBlob } from "../export/docx/renderDocx";
import { buildDownloadFilename, type DownloadExtension, downloadBlob } from "../export/download";
import { renderPdfBlob } from "../export/pdf/pdfmakeClient";
import {
  createProjectFile,
  type PreparedQuotationArtifacts,
  prepareQuotationArtifacts,
} from "../project/projectFiles";

export type QuotationExportFormat = "docx" | "pdf" | "json" | "opentrad";

export interface QuotationExportDependencies {
  prepare: (draft: unknown) => PreparedQuotationArtifacts;
  renderDocx: (model: PreparedQuotationArtifacts["model"]) => Promise<Blob>;
  renderPdf: (model: PreparedQuotationArtifacts["model"]) => Promise<Blob>;
  createProject: typeof createProjectFile;
  download: (blob: Blob, filename: string) => void;
  buildFilename: (basename: string, extension: DownloadExtension) => string;
}

export const defaultQuotationExportDependencies: QuotationExportDependencies = {
  prepare: prepareQuotationArtifacts,
  renderDocx: renderDocxBlob,
  renderPdf: renderPdfBlob,
  createProject: createProjectFile,
  download: downloadBlob,
  buildFilename: buildDownloadFilename,
};

export class QuotationExportError extends Error {
  readonly code = "EXPORT_FAILED" as const;

  constructor() {
    super("文件生成失败，请检查报价内容后重试");
    this.name = "QuotationExportError";
  }
}

export async function exportQuotation(
  format: QuotationExportFormat,
  draft: StandardGoodsQuoteDraft,
  dependencies: QuotationExportDependencies = defaultQuotationExportDependencies,
): Promise<string> {
  try {
    const artifacts = dependencies.prepare(draft);
    let blob: Blob;
    let filename: string;
    if (format === "docx") {
      blob = await dependencies.renderDocx(artifacts.model);
      filename = dependencies.buildFilename(artifacts.draft.meta.number, "docx");
    } else if (format === "pdf") {
      blob = await dependencies.renderPdf(artifacts.model);
      filename = dependencies.buildFilename(artifacts.draft.meta.number, "pdf");
    } else {
      const project = dependencies.createProject(artifacts, format, artifacts.draft.meta.number);
      blob = project.blob;
      filename = project.filename;
    }
    dependencies.download(blob, filename);
    return filename;
  } catch {
    throw new QuotationExportError();
  }
}
