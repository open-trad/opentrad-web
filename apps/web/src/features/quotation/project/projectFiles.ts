import {
  compileStandardGoodsQuote,
  type DocumentModel,
  MAX_PROJECT_BYTES,
  type OpenTradProjectEnvelope,
  parseDocumentDraft,
  parseProject,
  type StandardGoodsQuoteDraft,
  serializeProject,
} from "@opentrad/document-core";
import { buildDownloadFilename } from "../export/download";

export const PROJECT_JSON_MIME = "application/json;charset=utf-8";
export const OPENTRAD_PROJECT_MIME = "application/vnd.opentrad.project+json;charset=utf-8";

export interface PreparedQuotationArtifacts {
  draft: StandardGoodsQuoteDraft;
  model: DocumentModel;
  serializedProject: string;
}

export type ProjectFileLike = Pick<File, "size" | "text">;

export class ProjectFileError extends Error {
  readonly code: "PROJECT_INVALID" | "PROJECT_TOO_LARGE";

  constructor(code: "PROJECT_INVALID" | "PROJECT_TOO_LARGE") {
    super(
      code === "PROJECT_TOO_LARGE"
        ? "项目文件超过 1 MiB，请选择有效的 OpenTrad 项目文件"
        : "项目文件无效或版本不受支持",
    );
    this.name = "ProjectFileError";
    this.code = code;
  }
}

export function prepareQuotationArtifacts(input: unknown): PreparedQuotationArtifacts {
  const draft = parseDocumentDraft(input);
  return {
    draft,
    model: compileStandardGoodsQuote(draft),
    serializedProject: serializeProject(draft),
  };
}

export function createProjectFile(
  artifacts: PreparedQuotationArtifacts,
  format: "json" | "opentrad",
  basename: string,
): { blob: Blob; filename: string } {
  const type = format === "json" ? PROJECT_JSON_MIME : OPENTRAD_PROJECT_MIME;
  return {
    blob: new Blob([artifacts.serializedProject], { type }),
    filename: buildDownloadFilename(basename, format),
  };
}

export async function readProjectFile(file: ProjectFileLike): Promise<OpenTradProjectEnvelope> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PROJECT_BYTES) {
    throw new ProjectFileError("PROJECT_TOO_LARGE");
  }
  try {
    return parseProject(await file.text());
  } catch (error) {
    if (error instanceof ProjectFileError) {
      throw error;
    }
    throw new ProjectFileError("PROJECT_INVALID");
  }
}
