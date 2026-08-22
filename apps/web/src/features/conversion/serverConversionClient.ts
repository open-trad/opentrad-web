import {
  type CreateJobRequest,
  CreateJobRequestSchema,
  JobResponseSchema,
  type JobStatus,
} from "@opentrad/contracts";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{16,128}$/u;

function failure(): Error {
  return new Error("SERVER_JOB_REQUEST_FAILED");
}

function uploadMediaType(format: CreateJobRequest["inputFormat"]): string {
  switch (format) {
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "rtf":
      return "application/rtf";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ods":
      return "application/vnd.oasis.opendocument.spreadsheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "odp":
      return "application/vnd.oasis.opendocument.presentation";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "html":
      return "text/html";
    case "md":
      return "text/markdown";
    case "opentrad":
      return "application/vnd.opentrad.project+zip";
  }
}

async function readJobResponse(response: Response): Promise<JobStatus> {
  if (!response.ok) throw failure();
  try {
    return JobResponseSchema.parse(await response.json()).job;
  } catch {
    throw failure();
  }
}

async function requestJob(path: string, init: RequestInit): Promise<JobStatus> {
  try {
    return await readJobResponse(
      await fetch(path, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", ...init.headers },
      }),
    );
  } catch {
    throw failure();
  }
}

export async function submitServerJob(
  input: CreateJobRequest,
  file: File,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<JobStatus> {
  try {
    const request = CreateJobRequestSchema.parse(input);
    if (!IDEMPOTENCY_KEY.test(idempotencyKey) || file.size !== request.inputBytes) throw failure();
    const body = new FormData();
    body.append(
      "file",
      new Blob([file], { type: uploadMediaType(request.inputFormat) }),
      "upload.bin",
    );
    return await requestJob("/api/v1/jobs", {
      body,
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-OpenTrad-Job-Request": JSON.stringify(request),
        "X-OpenTrad-Processing-Consent": "server-v1",
      },
      method: "POST",
      signal,
    });
  } catch {
    throw failure();
  }
}

function jobPath(id: string): string {
  if (!JOB_ID.test(id)) throw failure();
  return `/api/v1/jobs/${id}`;
}

export function readServerJob(id: string, signal: AbortSignal): Promise<JobStatus> {
  return requestJob(jobPath(id), { method: "GET", signal });
}

export function cancelServerJob(id: string, signal: AbortSignal): Promise<JobStatus> {
  return requestJob(jobPath(id), { method: "DELETE", signal });
}
