import { finished } from "node:stream/promises";
import {
  CreateJobRequestSchema,
  type JobErrorCode,
  JobResponseSchema,
  type JobStatus,
} from "@opentrad/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthenticationRequiredError,
  requireSession,
  type SessionAuthRuntime,
} from "../auth/sessionGuard.js";
import { ScannerError } from "../jobs/clamdClient.js";
import { preflightJobInput } from "../jobs/inputPreflight.js";
import { runJobCleanup } from "../jobs/jobCleanup.js";
import { JobFileError, type JobFiles } from "../jobs/jobFiles.js";
import { JobAdmissionError, type JobRepository } from "../jobs/jobRepository.js";

const CONSENT = "server-v1";
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{16,128}$/u;
const MULTIPART =
  /^multipart\/form-data;[ \t]*boundary=(?:[A-Za-z0-9'()+_,./:=?-]{1,70}|"[A-Za-z0-9'()+_,./:=?-]{1,70}")$/u;
const MAX_METADATA_BYTES = 4_096;

export interface JobScanner {
  readonly scan: (source: AsyncIterable<Uint8Array>, signal?: AbortSignal) => Promise<"clean">;
}

export interface JobRouteRuntime {
  readonly files: JobFiles;
  readonly repository: JobRepository;
  readonly scanner: JobScanner;
}

interface ErrorResponseOptions {
  readonly code: JobErrorCode;
  readonly retryable?: boolean;
  readonly status: number;
}

class PartMediaTypeError extends JobFileError {
  constructor() {
    super("INVALID_REQUEST");
  }
}

function errorResponse(reply: FastifyReply, options: ErrorResponseOptions) {
  return reply.status(options.status).send({
    error: {
      code: options.code,
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    },
  });
}

function routeError(error: unknown): ErrorResponseOptions {
  if (error instanceof AuthenticationRequiredError) return { code: "AUTH_REQUIRED", status: 401 };
  if (error instanceof PartMediaTypeError) return { code: "INVALID_REQUEST", status: 415 };
  const code =
    error instanceof JobAdmissionError ||
    error instanceof JobFileError ||
    error instanceof ScannerError
      ? error.code
      : "INVALID_REQUEST";
  switch (code) {
    case "IDEMPOTENCY_CONFLICT":
    case "JOB_ALREADY_ACTIVE":
    case "JOB_NOT_READY":
      return { code, status: 409 };
    case "QUEUE_FULL":
    case "DAILY_QUOTA_EXCEEDED":
      return { code, retryable: true, status: 429 };
    case "PROCESSING_CONSENT_REQUIRED":
      return { code, status: 403 };
    case "FILE_TOO_LARGE":
      return { code, status: 413 };
    case "MALWARE_DETECTED":
      return { code, status: 422 };
    case "SCANNER_UNAVAILABLE":
      return { code, retryable: true, status: 503 };
    default:
      return { code: "INVALID_REQUEST", status: 400 };
  }
}

function partMediaTypeAllowed(
  format: ReturnType<typeof CreateJobRequestSchema.parse>["inputFormat"],
  mediaType: string,
): boolean {
  switch (format) {
    case "doc":
      return mediaType === "application/msword";
    case "docx":
      return (
        mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    case "xls":
      return mediaType === "application/vnd.ms-excel";
    case "xlsx":
      return mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ods":
      return mediaType === "application/vnd.oasis.opendocument.spreadsheet";
    case "ppt":
      return mediaType === "application/vnd.ms-powerpoint";
    case "pptx":
      return (
        mediaType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
    case "odp":
      return mediaType === "application/vnd.oasis.opendocument.presentation";
    case "odt":
      return mediaType === "application/vnd.oasis.opendocument.text";
    case "rtf":
      return mediaType === "application/rtf";
    case "pdf":
      return mediaType === "application/pdf";
    case "png":
      return mediaType === "image/png";
    case "jpg":
      return mediaType === "image/jpeg";
    case "webp":
      return mediaType === "image/webp";
    case "avif":
      return mediaType === "image/avif";
    case "html":
      return mediaType === "text/html";
    case "md":
      return mediaType === "text/markdown";
    case "opentrad":
      return (
        mediaType === "application/zip" || mediaType === "application/vnd.opentrad.project+zip"
      );
  }
}

function oneHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function requestLifetime(
  request: FastifyRequest,
  reply: FastifyReply,
): {
  readonly remove: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const requestClosed = () => {
    if (request.raw.aborted || !request.raw.complete) abort();
  };
  const replyClosed = () => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once("aborted", abort);
  request.raw.once("close", requestClosed);
  reply.raw.once("close", replyClosed);
  return {
    remove: () => {
      request.raw.removeListener("aborted", abort);
      request.raw.removeListener("close", requestClosed);
      reply.raw.removeListener("close", replyClosed);
    },
    signal: controller.signal,
  };
}

function admissionMetadata(request: FastifyRequest): {
  readonly idempotencyKey: string;
  readonly metadata: ReturnType<typeof CreateJobRequestSchema.parse>;
} {
  if (oneHeader(request, "x-opentrad-processing-consent") !== CONSENT) {
    throw new JobAdmissionError("PROCESSING_CONSENT_REQUIRED");
  }
  const idempotencyKey = oneHeader(request, "idempotency-key");
  const metadataHeader = oneHeader(request, "x-opentrad-job-request");
  const contentType = oneHeader(request, "content-type");
  if (
    idempotencyKey === undefined ||
    !IDEMPOTENCY_KEY.test(idempotencyKey) ||
    metadataHeader === undefined ||
    Buffer.byteLength(metadataHeader, "utf8") > MAX_METADATA_BYTES ||
    contentType === undefined ||
    !MULTIPART.test(contentType)
  ) {
    throw new JobAdmissionError("INVALID_REQUEST");
  }
  let input: unknown;
  try {
    input = JSON.parse(metadataHeader);
  } catch {
    throw new JobAdmissionError("INVALID_REQUEST");
  }
  try {
    return { idempotencyKey, metadata: CreateJobRequestSchema.parse(input) };
  } catch {
    throw new JobAdmissionError("INVALID_REQUEST");
  }
}

function jobId(request: FastifyRequest): string | undefined {
  const value = (request.params as { id?: unknown }).id;
  return typeof value === "string" && JOB_ID.test(value) ? value : undefined;
}

function sendJob(reply: FastifyReply, job: JobStatus, status = 200) {
  return reply.status(status).send(JobResponseSchema.parse({ job }));
}

function operationToken(operation: JobStatus["operation"]): string {
  switch (operation) {
    case "office.to.pdf":
      return "office-to-pdf";
    case "spreadsheet.to.csv":
      return "spreadsheet-to-csv";
    case "structured.convert":
      return "structured-convert";
    case "ocr.pdf":
      return "ocr-pdf";
    case "ocr.image":
      return "ocr-image";
    case "image.convert.hq":
      return "image-convert-hq";
    case "pdf.repair":
      return "pdf-repair";
    case "pdf.text-to-docx":
      return "pdf-text-to-docx";
    case "bid.assemble":
      return "bid-assemble";
  }
}

function extension(mediaType: string): string | undefined {
  switch (mediaType) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.oasis.opendocument.text":
      return "odt";
    case "application/rtf":
      return "rtf";
    case "text/csv":
      return "csv";
    case "text/html":
      return "html";
    case "text/markdown":
      return "md";
    case "text/plain":
      return "txt";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return undefined;
  }
}

function resultHeaders(reply: FastifyReply, job: JobStatus): boolean {
  const result = job.result;
  const resultExtension = result ? extension(result.mediaType) : undefined;
  if (!result || resultExtension === undefined) return false;
  const date = job.createdAt.slice(0, 10);
  reply.header("accept-ranges", "none");
  reply.header("cache-control", "no-store");
  reply.header(
    "content-disposition",
    `attachment; filename="opentrad-${operationToken(job.operation)}-${date}.${resultExtension}"`,
  );
  reply.header("content-length", String(result.sizeBytes));
  reply.type(result.mediaType);
  return true;
}

async function ownedJob(
  request: FastifyRequest,
  runtime: JobRouteRuntime,
  authenticatedOwner: (request: FastifyRequest) => Promise<string>,
): Promise<{ readonly id: string; readonly ownerId: string; readonly job: JobStatus } | undefined> {
  const ownerId = await authenticatedOwner(request);
  await runJobCleanup(runtime);
  const id = jobId(request);
  if (id === undefined) return undefined;
  const job = runtime.repository.findOwnedJob(ownerId, id);
  return job ? { id, job, ownerId } : undefined;
}

export function registerJobRoutes(
  app: FastifyInstance,
  auth: SessionAuthRuntime,
  runtime: JobRouteRuntime,
  admissionEnabled = true,
  rateBoundary: (request: FastifyRequest) => string,
): void {
  const ownerByRequest = new WeakMap<FastifyRequest, string>();
  const authenticatedOwner = async (request: FastifyRequest): Promise<string> => {
    const existing = ownerByRequest.get(request);
    if (existing !== undefined) return existing;
    const session = await requireSession(request, auth);
    ownerByRequest.set(request, session.userId);
    return session.userId;
  };
  const protectedRoute = (groupId: "jobs-admission" | "jobs-access", max: number) => ({
    config: {
      rateLimit: {
        groupId,
        keyGenerator: async (request: FastifyRequest) => {
          let owner = "unauthenticated";
          try {
            owner = await authenticatedOwner(request);
          } catch {
            // Unauthenticated floods retain an IP-only bucket and the handler returns the fixed 401.
          }
          return `${rateBoundary(request)}:owner:${owner}`;
        },
        max,
        timeWindow: 60_000,
      },
    },
  });
  app.options("/api/v1/jobs", async (_request, reply) => reply.status(204).send());
  app.options("/api/v1/jobs/:id", async (_request, reply) => reply.status(204).send());
  app.options("/api/v1/jobs/:id/result", async (_request, reply) => reply.status(204).send());

  app.post("/api/v1/jobs", protectedRoute("jobs-admission", 10), async (request, reply) => {
    const lifetime = requestLifetime(request, reply);
    let ownerId: string | undefined;
    let jobIdToRollback: string | undefined;
    try {
      ownerId = await authenticatedOwner(request);
      const admission = admissionMetadata(request);
      if (!admissionEnabled) throw new ScannerError("SCANNER_UNAVAILABLE");
      await runJobCleanup(runtime);
      const reservation = runtime.repository.reserveAdmission({
        idempotencyKey: admission.idempotencyKey,
        ownerId,
        request: admission.metadata,
      });
      if (reservation.replayed) return sendJob(reply, reservation.job, 200);
      jobIdToRollback = reservation.job.id;

      let fileParts = 0;
      let queued: Awaited<ReturnType<JobFiles["stageAndQueue"]>> | undefined;
      const parts = request.parts({
        limits: {
          fieldNameSize: 32,
          fields: 0,
          fileSize: admission.metadata.inputBytes,
          files: 1,
          headerPairs: 4,
          parts: 1,
        },
      });
      for await (const part of parts) {
        if (part.type !== "file" || part.fieldname !== "file" || fileParts !== 0) {
          throw new JobFileError("INVALID_REQUEST");
        }
        if (!partMediaTypeAllowed(admission.metadata.inputFormat, part.mimetype)) {
          throw new PartMediaTypeError();
        }
        fileParts += 1;
        queued = await runtime.files.stageAndQueue({
          declaredBytes: admission.metadata.inputBytes,
          jobId: reservation.job.id,
          request: admission.metadata,
          scan: (source, signal) => runtime.scanner.scan(source, signal),
          signal: lifetime.signal,
          source: part.file,
          validate: (path, signal) => preflightJobInput(path, admission.metadata, signal),
        });
        if (part.file.truncated) throw new JobFileError("FILE_TOO_LARGE");
      }
      if (fileParts !== 1 || queued === undefined) throw new JobFileError("INVALID_REQUEST");
      if (!runtime.repository.markQueued(reservation.job.id)) {
        throw new JobFileError("INVALID_REQUEST");
      }
      jobIdToRollback = undefined;
      const job = runtime.repository.findOwnedJob(ownerId, reservation.job.id);
      if (!job) throw new JobFileError("INVALID_REQUEST");
      return sendJob(reply, job, 202);
    } catch (error) {
      if (jobIdToRollback && ownerId) {
        try {
          await runtime.files.destroy(jobIdToRollback);
        } catch {
          // Database rollback remains authoritative and the error stays fixed.
        }
        runtime.repository.rollbackAdmission(jobIdToRollback, ownerId);
      }
      return errorResponse(reply, routeError(error));
    } finally {
      lifetime.remove();
    }
  });

  app.get("/api/v1/jobs/:id", protectedRoute("jobs-access", 60), async (request, reply) => {
    try {
      const owned = await ownedJob(request, runtime, authenticatedOwner);
      return owned
        ? sendJob(reply, owned.job)
        : errorResponse(reply, { code: "INVALID_REQUEST", status: 404 });
    } catch (error) {
      return errorResponse(reply, routeError(error));
    }
  });

  app.delete("/api/v1/jobs/:id", protectedRoute("jobs-access", 60), async (request, reply) => {
    try {
      const ownerId = await authenticatedOwner(request);
      const id = jobId(request);
      if (!id) return errorResponse(reply, { code: "INVALID_REQUEST", status: 404 });
      const decision = runtime.repository.cancelOwnedJob(ownerId, id);
      if (!decision) return errorResponse(reply, { code: "INVALID_REQUEST", status: 404 });
      if (decision.cleanupFiles) {
        const claim = runtime.repository.claimCleanup(id);
        if (!claim) {
          return errorResponse(reply, {
            code: "INVALID_REQUEST",
            retryable: true,
            status: 503,
          });
        }
        try {
          const claimedQueued = await runtime.files.cancelQueued(id);
          if (!claimedQueued) {
            if (!runtime.repository.deferRunningCancellation(id, claim.token)) {
              runtime.repository.releaseCleanupClaim(id, claim.token);
              return errorResponse(reply, {
                code: "INVALID_REQUEST",
                retryable: true,
                status: 503,
              });
            }
            try {
              await runtime.files.requestCancellation(id);
            } catch {
              return errorResponse(reply, {
                code: "INVALID_REQUEST",
                retryable: true,
                status: 503,
              });
            }
          } else {
            await runtime.files.destroy(id);
          }
          if (claimedQueued && !runtime.repository.completeCleanup(id, claim.token)) {
            runtime.repository.releaseCleanupClaim(id, claim.token);
            return errorResponse(reply, {
              code: "INVALID_REQUEST",
              retryable: true,
              status: 503,
            });
          }
        } catch {
          runtime.repository.releaseCleanupClaim(id, claim.token);
          return errorResponse(reply, {
            code: "INVALID_REQUEST",
            retryable: true,
            status: 503,
          });
        }
      } else if (decision.job.status === "cancelling") {
        try {
          await runtime.files.requestCancellation(id);
        } catch {
          return errorResponse(reply, {
            code: "INVALID_REQUEST",
            retryable: true,
            status: 503,
          });
        }
      }
      const updated = runtime.repository.findOwnedJob(ownerId, id);
      return updated
        ? sendJob(reply, updated)
        : errorResponse(reply, { code: "INVALID_REQUEST", status: 404 });
    } catch (error) {
      return errorResponse(reply, routeError(error));
    }
  });

  const headResult = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const owned = await ownedJob(request, runtime, authenticatedOwner);
      if (!owned) return reply.status(404).send();
      if (oneHeader(request, "range") !== undefined) {
        return reply.status(416).send();
      }
      if (owned.job.status !== "succeeded" || !owned.job.result) {
        return reply.status(409).send();
      }
      const size = await runtime.files.resultSize(owned.id);
      if (size !== owned.job.result.sizeBytes || !resultHeaders(reply, owned.job)) {
        return reply.status(409).send();
      }
      return reply.status(200).send();
    } catch (error) {
      return reply.status(routeError(error).status).send();
    }
  };
  app.head("/api/v1/jobs/:id/result", protectedRoute("jobs-access", 60), headResult);

  app.get("/api/v1/jobs/:id/result", protectedRoute("jobs-access", 60), async (request, reply) => {
    let claim: ReturnType<JobRepository["claimResult"]>;
    try {
      const owned = await ownedJob(request, runtime, authenticatedOwner);
      if (!owned) return errorResponse(reply, { code: "INVALID_REQUEST", status: 404 });
      if (oneHeader(request, "range") !== undefined) {
        return errorResponse(reply, { code: "INVALID_REQUEST", status: 416 });
      }
      if (owned.job.status !== "succeeded" || !owned.job.result) {
        return errorResponse(reply, { code: "JOB_NOT_READY", status: 409 });
      }
      const opened = await runtime.files.openResult(owned.id);
      if (!opened || opened.size !== owned.job.result.sizeBytes) {
        await opened?.close();
        return errorResponse(reply, { code: "JOB_NOT_READY", status: 409 });
      }
      claim = runtime.repository.claimResult(owned.ownerId, owned.id);
      if (!claim) {
        await opened.close();
        return errorResponse(reply, { code: "JOB_NOT_READY", status: 409 });
      }
      if (!resultHeaders(reply, owned.job)) {
        await opened.close();
        runtime.repository.releaseResultClaim(owned.ownerId, owned.id, claim.token);
        return errorResponse(reply, { code: "JOB_NOT_READY", status: 409 });
      }
      reply.send(opened.stream);
      try {
        await finished(reply.raw);
        await opened.close();
        const cleanup = runtime.repository.beginResultCleanup(owned.ownerId, owned.id, claim.token);
        if (!cleanup) {
          runtime.repository.releaseResultClaim(owned.ownerId, owned.id, claim.token);
        } else {
          try {
            await runtime.files.destroy(owned.id);
            if (!runtime.repository.completeCleanup(owned.id, cleanup.token)) {
              runtime.repository.releaseCleanupClaim(owned.id, cleanup.token);
            }
          } catch {
            runtime.repository.releaseCleanupClaim(owned.id, cleanup.token);
          }
        }
      } catch {
        await opened.close().catch(() => undefined);
        runtime.repository.releaseResultClaim(owned.ownerId, owned.id, claim.token);
      }
      return reply;
    } catch (error) {
      return errorResponse(reply, routeError(error));
    }
  });
}
