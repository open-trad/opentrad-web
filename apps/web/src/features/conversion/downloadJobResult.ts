import type { JobStatus } from "@opentrad/contracts";
import { downloadBlob } from "../quotation/export/download";

export type SaveServerResult = (
  bytes: Uint8Array<ArrayBuffer>,
  mediaType: string,
  name: string,
) => void;

function resultFailure(): Error {
  return new Error("SERVER_RESULT_INVALID");
}

function extension(mediaType: string): string {
  switch (mediaType) {
    case "application/pdf":
      return "pdf";
    case "application/rtf":
      return "rtf";
    case "application/vnd.oasis.opendocument.text":
      return "odt";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "image/avif":
      return "avif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "text/csv":
      return "csv";
    case "text/html":
      return "html";
    case "text/markdown":
      return "md";
    case "text/plain":
      return "txt";
    default:
      throw resultFailure();
  }
}

export const saveServerResult: SaveServerResult = (bytes, mediaType, name) => {
  downloadBlob(new Blob([bytes], { type: mediaType }), name);
};

export async function downloadJobResult(
  job: JobStatus,
  signal: AbortSignal,
  save: SaveServerResult = saveServerResult,
): Promise<void> {
  const result = job.status === "succeeded" ? job.result : undefined;
  if (!result || !result.ready) throw resultFailure();
  try {
    const response = await fetch(`/api/v1/jobs/${job.id}/result`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: result.mediaType },
      method: "GET",
      signal,
    });
    if (!response.ok) throw resultFailure();
    const mediaType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");
    if (mediaType !== result.mediaType || contentLength !== String(result.sizeBytes)) {
      throw resultFailure();
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== result.sizeBytes) throw resultFailure();
    save(
      bytes,
      result.mediaType,
      `opentrad-server-${job.operation.replaceAll(".", "-")}.${extension(result.mediaType)}`,
    );
  } catch {
    throw resultFailure();
  }
}
