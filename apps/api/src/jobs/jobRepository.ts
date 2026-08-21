import { randomUUID } from "node:crypto";
import {
  type CreateJobRequest,
  CreateJobRequestSchema,
  type JobErrorCode,
  type JobStatus,
  JobStatusSchema,
  type JobStatusValue,
} from "@opentrad/contracts";
import type Database from "better-sqlite3";
import { canonicalRequestShape, idempotencyKeyHmac, requestShapesEqual } from "./idempotency.js";

const ADMISSION_TTL_MS = 15 * 60_000;
const CLEANUP_CLAIM_LEASE_MS = 5 * 60_000;
const RESULT_CLAIM_LEASE_MS = 5 * 60_000;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicDateToISOString = Date.prototype.toISOString;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;

interface JobRow {
  readonly id: string;
  readonly owner_id: string;
  readonly operation: CreateJobRequest["operation"];
  readonly quality: "A" | "B" | "C";
  readonly status: JobStatusValue;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly expires_at: number;
  readonly queue_position: 0 | 1 | null;
  readonly progress_phase: "admission" | "queued" | "converting" | "finalizing" | null;
  readonly progress_completed: number | null;
  readonly progress_total: number | null;
  readonly error_code: JobErrorCode | null;
  readonly error_retryable: 0 | 1 | null;
  readonly result_media_type: string | null;
  readonly result_bytes: number | null;
  readonly cancel_requested: 0 | 1;
  readonly result_claim_token: string | null;
  readonly result_consumed: 0 | 1;
  readonly cleanup_kind: "expiry" | "cancel" | "consume" | null;
  readonly cleanup_token: string | null;
  readonly cleanup_claimed_at: number | null;
}

interface IdempotencyRow {
  readonly job_id: string;
  readonly request_shape: string;
}

export interface JobRepositoryOptions {
  readonly idempotencySecret: string;
  readonly now?: () => number;
}

export interface ReserveAdmissionInput {
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly request: unknown;
}

export interface ReservedAdmission {
  readonly job: JobStatus;
  readonly replayed: boolean;
}

export interface CancelDecision {
  readonly job: JobStatus;
  readonly cleanupFiles: boolean;
}

export interface ResultClaim {
  readonly job: JobStatus;
  readonly token: string;
}

export interface CleanupClaim {
  readonly jobId: string;
  readonly kind: "expiry" | "cancel" | "consume";
  readonly token: string;
}

export class JobAdmissionError extends Error {
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode) {
    super(code);
    this.code = code;
  }
}

function quality(operation: CreateJobRequest["operation"]): "A" | "B" | "C" {
  if (operation === "image.convert.hq") return "A";
  if (operation === "pdf.text-to-docx") return "C";
  return "B";
}

function utcDay(milliseconds: number): string {
  return intrinsicReflectApply(intrinsicDateToISOString, new Date(milliseconds), []).slice(0, 10);
}

function isoTime(milliseconds: number): string {
  return intrinsicReflectApply(intrinsicDateToISOString, new Date(milliseconds), []);
}

function rowToStatus(row: JobRow): JobStatus {
  const value: Record<string, unknown> = {
    id: row.id,
    operation: row.operation,
    status: row.status,
    quality: row.quality,
    createdAt: isoTime(row.created_at),
    expiresAt: isoTime(row.expires_at),
  };
  if (row.started_at !== null) value.startedAt = isoTime(row.started_at);
  if (row.queue_position !== null && row.status === "queued") {
    value.queuePosition = row.queue_position;
  }
  if (
    row.progress_phase !== null &&
    row.progress_completed !== null &&
    row.progress_total !== null
  ) {
    value.progress = {
      phase: row.progress_phase,
      completed: row.progress_completed,
      total: row.progress_total,
    };
  }
  if (row.status === "succeeded" && row.result_media_type !== null && row.result_bytes !== null) {
    value.result = { ready: true, mediaType: row.result_media_type, sizeBytes: row.result_bytes };
  }
  if (row.status === "failed" && row.error_code !== null && row.error_retryable !== null) {
    value.error = { code: row.error_code, retryable: row.error_retryable === 1 };
  }
  return JobStatusSchema.parse(value);
}

function jobSelect(): string {
  return `SELECT id, owner_id, operation, quality, status, created_at, started_at, expires_at,
    queue_position, progress_phase, progress_completed, progress_total, error_code,
    error_retryable, result_media_type, result_bytes, cancel_requested,
    result_claim_token, result_consumed, cleanup_kind, cleanup_token,
    cleanup_claimed_at FROM jobs`;
}

export class JobRepository {
  readonly #database: Database.Database;
  readonly #secret: string;
  readonly #now: () => number;

  constructor(database: Database.Database, options: JobRepositoryOptions) {
    if (!database?.open || options === null || typeof options !== "object") {
      throw new Error("JOB_REPOSITORY_INVALID");
    }
    const prototype = intrinsicGetPrototypeOf(options);
    const keys = intrinsicReflectOwnKeys(options);
    if (
      (prototype !== intrinsicObjectPrototype && prototype !== null) ||
      keys.length < 1 ||
      keys.length > 2
    ) {
      throw new Error("JOB_REPOSITORY_INVALID");
    }
    for (const key of keys) {
      if (key !== "idempotencySecret" && key !== "now") {
        throw new Error("JOB_REPOSITORY_INVALID");
      }
    }
    const secretDescriptor = intrinsicReflectGetOwnPropertyDescriptor(options, "idempotencySecret");
    const nowDescriptor = intrinsicReflectGetOwnPropertyDescriptor(options, "now");
    if (
      !secretDescriptor ||
      !("value" in secretDescriptor) ||
      typeof secretDescriptor.value !== "string" ||
      (nowDescriptor !== undefined &&
        (!("value" in nowDescriptor) || typeof nowDescriptor.value !== "function"))
    ) {
      throw new Error("JOB_REPOSITORY_INVALID");
    }
    this.#database = database;
    this.#secret = secretDescriptor.value;
    const clock = nowDescriptor && "value" in nowDescriptor ? nowDescriptor.value : Date.now;
    this.#now = () => intrinsicReflectApply(clock as () => number, undefined, []);
  }

  reserveAdmission(input: ReserveAdmissionInput): ReservedAdmission {
    const request = CreateJobRequestSchema.parse(input.request);
    const shape = canonicalRequestShape(request);
    const keyHmac = idempotencyKeyHmac(this.#secret, input.ownerId, input.idempotencyKey);
    const now = this.#now();
    const expiresAt = now + ADMISSION_TTL_MS;
    const day = utcDay(now);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database
        .prepare(
          "SELECT job_id, request_shape FROM idempotency WHERE owner_id = ? AND key_hmac = ?",
        )
        .get(input.ownerId, keyHmac) as IdempotencyRow | undefined;
      if (existing !== undefined) {
        if (!requestShapesEqual(existing.request_shape, shape)) {
          throw new JobAdmissionError("IDEMPOTENCY_CONFLICT");
        }
        const row = this.#jobByOwner(input.ownerId, existing.job_id);
        if (row === undefined) throw new Error("JOB_REPOSITORY_STATE_INVALID");
        if (row.result_consumed === 1 || row.cleanup_kind === "consume") {
          throw new JobAdmissionError("JOB_NOT_READY");
        }
        this.#database.exec("COMMIT");
        return Object.freeze({ job: rowToStatus(row), replayed: true });
      }

      const ownerActive = this.#database
        .prepare(
          "SELECT 1 FROM jobs WHERE owner_id = ? AND status IN ('queued','running','cancelling') LIMIT 1",
        )
        .get(input.ownerId);
      if (ownerActive !== undefined) throw new JobAdmissionError("JOB_ALREADY_ACTIVE");
      const queueCount = this.#database
        .prepare("SELECT count(*) AS count FROM jobs WHERE status = 'queued'")
        .get() as { count: number };
      if (queueCount.count >= 1) throw new JobAdmissionError("QUEUE_FULL");
      const runningCount = this.#database
        .prepare("SELECT count(*) AS count FROM jobs WHERE status IN ('running','cancelling')")
        .get() as { count: number };
      if (runningCount.count >= 1 && queueCount.count >= 1) {
        throw new JobAdmissionError("QUEUE_FULL");
      }
      const usage = this.#database
        .prepare("SELECT accepted_count FROM daily_usage WHERE owner_id = ? AND utc_day = ?")
        .get(input.ownerId, day) as { accepted_count: number } | undefined;
      if ((usage?.accepted_count ?? 0) >= 10) {
        throw new JobAdmissionError("DAILY_QUOTA_EXCEEDED");
      }

      const id = randomUUID();
      const queuePosition = runningCount.count === 0 ? 0 : 1;
      this.#database
        .prepare(
          `INSERT INTO jobs
            (id, owner_id, operation, input_format, output_format, quality, status, input_bytes,
             created_at, expires_at, queue_position, progress_phase, progress_completed, progress_total)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, 'admission', 0, ?)`,
        )
        .run(
          id,
          input.ownerId,
          request.operation,
          request.inputFormat,
          request.outputFormat,
          quality(request.operation),
          request.inputBytes,
          now,
          expiresAt,
          queuePosition,
          request.inputBytes,
        );
      this.#database
        .prepare(
          `INSERT INTO idempotency
            (owner_id, key_hmac, operation, input_format, output_format, input_bytes, job_id,
             expires_at, request_shape)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.ownerId,
          keyHmac,
          request.operation,
          request.inputFormat,
          request.outputFormat,
          request.inputBytes,
          id,
          expiresAt,
          shape,
        );
      this.#database
        .prepare(
          `INSERT INTO daily_usage (owner_id, utc_day, accepted_count) VALUES (?, ?, 1)
           ON CONFLICT(owner_id, utc_day) DO UPDATE SET accepted_count = accepted_count + 1`,
        )
        .run(input.ownerId, day);
      const created = this.#jobByOwner(input.ownerId, id);
      if (created === undefined) throw new Error("JOB_REPOSITORY_STATE_INVALID");
      this.#database.exec("COMMIT");
      return Object.freeze({ job: rowToStatus(created), replayed: false });
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  rollbackAdmission(jobId: string, ownerId: string): boolean {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#jobByOwner(ownerId, jobId);
      if (row === undefined || row.status !== "queued" || row.progress_phase !== "admission") {
        this.#database.exec("COMMIT");
        return false;
      }
      const day = utcDay(row.created_at);
      this.#database.prepare("DELETE FROM jobs WHERE id = ? AND owner_id = ?").run(jobId, ownerId);
      this.#database
        .prepare(
          "UPDATE daily_usage SET accepted_count = accepted_count - 1 WHERE owner_id = ? AND utc_day = ?",
        )
        .run(ownerId, day);
      this.#database
        .prepare(
          "DELETE FROM daily_usage WHERE owner_id = ? AND utc_day = ? AND accepted_count = 0",
        )
        .run(ownerId, day);
      this.#database.exec("COMMIT");
      return true;
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  markQueued(jobId: string): boolean {
    const changed = this.#database
      .prepare(
        "UPDATE jobs SET progress_phase='queued', progress_completed=0 WHERE id=? AND status='queued' AND progress_phase='admission'",
      )
      .run(jobId);
    return changed.changes === 1;
  }

  markRunning(jobId: string): boolean {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.#database
        .prepare("SELECT 1 FROM jobs WHERE status IN ('running','cancelling') AND id <> ? LIMIT 1")
        .get(jobId);
      if (active !== undefined) {
        this.#database.exec("COMMIT");
        return false;
      }
      const changed = this.#database
        .prepare(
          `UPDATE jobs SET status='running', started_at=?, queue_position=NULL,
             progress_phase='converting', progress_completed=0
           WHERE id=? AND status='queued'`,
        )
        .run(this.#now(), jobId);
      this.#database.exec("COMMIT");
      return changed.changes === 1;
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  markTerminal(
    jobId: string,
    status: "cancelled" | "failed" | "succeeded",
    details?: {
      readonly errorCode?: JobErrorCode;
      readonly retryable?: boolean;
      readonly mediaType?: string;
      readonly resultBytes?: number;
    },
  ): boolean {
    let changed: Database.RunResult;
    if (status === "succeeded") {
      changed = this.#database
        .prepare(
          `UPDATE jobs SET status='succeeded', queue_position=NULL, progress_phase=NULL,
             progress_completed=NULL, progress_total=NULL, result_media_type=?, result_bytes=?,
             error_code=NULL, error_retryable=NULL
           WHERE id=? AND status IN ('queued','running','cancelling')`,
        )
        .run(details?.mediaType, details?.resultBytes, jobId);
    } else if (status === "failed") {
      changed = this.#database
        .prepare(
          `UPDATE jobs SET status='failed', queue_position=NULL, progress_phase=NULL,
             progress_completed=NULL, progress_total=NULL, error_code=?, error_retryable=?,
             result_media_type=NULL, result_bytes=NULL
           WHERE id=? AND status IN ('queued','running','cancelling')`,
        )
        .run(details?.errorCode, details?.retryable ? 1 : 0, jobId);
    } else {
      changed = this.#database
        .prepare(
          `UPDATE jobs SET status='cancelled', queue_position=NULL, progress_phase=NULL,
             progress_completed=NULL, progress_total=NULL, error_code=NULL, error_retryable=NULL,
             result_media_type=NULL, result_bytes=NULL
           WHERE id=? AND status IN ('queued','running','cancelling')`,
        )
        .run(jobId);
    }
    if (changed.changes === 1) this.#rebalanceQueue();
    return changed.changes === 1;
  }

  findOwnedJob(ownerId: string, jobId: string): JobStatus | undefined {
    const row = this.#jobByOwner(ownerId, jobId);
    return row === undefined || row.result_consumed === 1 ? undefined : rowToStatus(row);
  }

  cancelOwnedJob(ownerId: string, jobId: string): CancelDecision | undefined {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#jobByOwner(ownerId, jobId);
      if (row === undefined) {
        this.#database.exec("COMMIT");
        return undefined;
      }
      let cleanupFiles = false;
      if (row.status === "queued") {
        this.#database
          .prepare(
            `UPDATE jobs SET status='cancelling', cancel_requested=1, cleanup_kind='cancel',
               cleanup_token=NULL, cleanup_claimed_at=NULL
             WHERE id=? AND status='queued'`,
          )
          .run(jobId);
        cleanupFiles = true;
      } else if (row.status === "running") {
        this.#database
          .prepare("UPDATE jobs SET status='cancelling', cancel_requested=1 WHERE id=?")
          .run(jobId);
      } else if (row.status === "cancelling" && row.cleanup_kind === "cancel") {
        cleanupFiles = true;
      }
      const updated = this.#jobByOwner(ownerId, jobId);
      if (updated === undefined) throw new Error("JOB_REPOSITORY_STATE_INVALID");
      this.#database.exec("COMMIT");
      return Object.freeze({ cleanupFiles, job: rowToStatus(updated) });
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  claimResult(ownerId: string, jobId: string): ResultClaim | undefined {
    const token = randomUUID();
    const now = this.#now();
    const changed = this.#database
      .prepare(
        `UPDATE jobs SET result_claim_token=?, result_claimed_at=?
         WHERE id=? AND owner_id=? AND status='succeeded' AND result_consumed=0
           AND (result_claim_token IS NULL OR result_claimed_at <= ?)
           AND cleanup_kind IS NULL`,
      )
      .run(token, now, jobId, ownerId, now - RESULT_CLAIM_LEASE_MS);
    if (changed.changes !== 1) return undefined;
    const row = this.#jobByOwner(ownerId, jobId);
    if (row === undefined) return undefined;
    return Object.freeze({ job: rowToStatus(row), token });
  }

  releaseResultClaim(ownerId: string, jobId: string, token: string): boolean {
    return (
      this.#database
        .prepare(
          "UPDATE jobs SET result_claim_token=NULL, result_claimed_at=NULL WHERE id=? AND owner_id=? AND result_claim_token=? AND result_consumed=0 AND cleanup_kind IS NULL",
        )
        .run(jobId, ownerId, token).changes === 1
    );
  }

  beginResultCleanup(
    ownerId: string,
    jobId: string,
    resultToken: string,
  ): CleanupClaim | undefined {
    const token = randomUUID();
    const changed = this.#database
      .prepare(
        `UPDATE jobs SET cleanup_kind='consume', cleanup_token=?, cleanup_claimed_at=?
         WHERE id=? AND owner_id=? AND status='succeeded' AND result_consumed=0
           AND result_claim_token=? AND cleanup_kind IS NULL`,
      )
      .run(token, this.#now(), jobId, ownerId, resultToken);
    return changed.changes === 1
      ? Object.freeze({ jobId, kind: "consume" as const, token })
      : undefined;
  }

  claimCleanup(jobId: string): CleanupClaim | undefined {
    const now = this.#now();
    const staleBefore = now - CLEANUP_CLAIM_LEASE_MS;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare(
          `SELECT cleanup_kind FROM jobs WHERE id=? AND cleanup_kind IS NOT NULL
             AND (cleanup_token IS NULL OR cleanup_claimed_at <= ?)`,
        )
        .raw(true)
        .get(jobId, staleBefore) as [CleanupClaim["kind"]] | undefined;
      if (!row) {
        this.#database.exec("COMMIT");
        return undefined;
      }
      const kind = row[0];
      const token = randomUUID();
      const changed = this.#database
        .prepare(
          `UPDATE jobs SET cleanup_token=?, cleanup_claimed_at=? WHERE id=?
             AND cleanup_kind=? AND (cleanup_token IS NULL OR cleanup_claimed_at <= ?)`,
        )
        .run(token, now, jobId, kind, staleBefore);
      if (changed.changes !== 1) throw new Error("JOB_REPOSITORY_STATE_INVALID");
      this.#database.exec("COMMIT");
      return Object.freeze({ jobId, kind, token });
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  claimPendingCleanup(limit: number): readonly CleanupClaim[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new Error("JOB_REPOSITORY_INVALID");
    }
    const rows = this.#database
      .prepare(
        `SELECT id FROM jobs WHERE cleanup_kind IS NOT NULL
           AND (cleanup_token IS NULL OR cleanup_claimed_at <= ?)
         ORDER BY cleanup_claimed_at, id LIMIT ?`,
      )
      .raw(true)
      .all(this.#now() - CLEANUP_CLAIM_LEASE_MS, limit) as Array<[string]>;
    const claims: CleanupClaim[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const jobId = rows[index]?.[0];
      if (typeof jobId !== "string") throw new Error("JOB_REPOSITORY_STATE_INVALID");
      const claim = this.claimCleanup(jobId);
      if (claim) intrinsicReflectApply(intrinsicArrayPush, claims, [claim]);
    }
    return Object.freeze(claims);
  }

  claimExpiredCleanup(limit: number): readonly CleanupClaim[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new Error("JOB_REPOSITORY_INVALID");
    }
    const now = this.#now();
    const staleBefore = now - CLEANUP_CLAIM_LEASE_MS;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#database
        .prepare(
          `SELECT id FROM jobs
           WHERE expires_at <= ? AND (cleanup_token IS NULL OR cleanup_claimed_at <= ?)
             AND (cleanup_kind IS NULL OR cleanup_kind='expiry')
           ORDER BY expires_at, id LIMIT ?`,
        )
        .raw(true)
        .all(now, staleBefore, limit) as Array<[string]>;
      const claims: CleanupClaim[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const jobId = rows[index]?.[0];
        if (typeof jobId !== "string") throw new Error("JOB_REPOSITORY_STATE_INVALID");
        const token = randomUUID();
        const changed = this.#database
          .prepare(
            `UPDATE jobs SET cleanup_kind='expiry', cleanup_token=?, cleanup_claimed_at=?
             WHERE id=? AND (cleanup_token IS NULL OR cleanup_claimed_at <= ?)
               AND (cleanup_kind IS NULL OR cleanup_kind='expiry')`,
          )
          .run(token, now, jobId, staleBefore);
        if (changed.changes !== 1) throw new Error("JOB_REPOSITORY_STATE_INVALID");
        intrinsicReflectApply(intrinsicArrayPush, claims, [
          Object.freeze({ jobId, kind: "expiry" as const, token }),
        ]);
      }
      this.#database.exec("COMMIT");
      return Object.freeze(claims);
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  releaseCleanupClaim(jobId: string, token: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE jobs SET cleanup_token=NULL, cleanup_claimed_at=NULL
           WHERE id=? AND cleanup_token=? AND cleanup_kind IS NOT NULL`,
        )
        .run(jobId, token).changes === 1
    );
  }

  completeCleanup(jobId: string, token: string): boolean {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare("SELECT cleanup_kind FROM jobs WHERE id=? AND cleanup_token=?")
        .raw(true)
        .get(jobId, token) as [CleanupClaim["kind"]] | undefined;
      if (!row) {
        this.#database.exec("COMMIT");
        return false;
      }
      let changed: Database.RunResult;
      const kind = row[0];
      if (kind === "expiry") {
        changed = this.#database
          .prepare("DELETE FROM jobs WHERE id=? AND cleanup_token=?")
          .run(jobId, token);
      } else if (kind === "cancel") {
        changed = this.#database
          .prepare(
            `UPDATE jobs SET status='cancelled', queue_position=NULL, progress_phase=NULL,
               progress_completed=NULL, progress_total=NULL, error_code=NULL,
               error_retryable=NULL, result_media_type=NULL, result_bytes=NULL,
               cleanup_kind=NULL, cleanup_token=NULL, cleanup_claimed_at=NULL
             WHERE id=? AND cleanup_token=? AND status='cancelling'`,
          )
          .run(jobId, token);
      } else {
        changed = this.#database
          .prepare(
            `UPDATE jobs SET result_consumed=1, result_claim_token=NULL, result_claimed_at=NULL,
               cleanup_kind=NULL, cleanup_token=NULL, cleanup_claimed_at=NULL
             WHERE id=? AND cleanup_token=? AND status='succeeded' AND result_consumed=0`,
          )
          .run(jobId, token);
      }
      if (changed.changes !== 1) throw new Error("JOB_REPOSITORY_STATE_INVALID");
      this.#database.exec("COMMIT");
      if (kind === "cancel") this.#rebalanceQueue();
      return true;
    } catch (error) {
      if (this.#database.inTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #rebalanceQueue(): void {
    const running = this.#database
      .prepare("SELECT 1 FROM jobs WHERE status IN ('running','cancelling') LIMIT 1")
      .raw(true)
      .get();
    if (running === undefined) {
      this.#database.prepare("UPDATE jobs SET queue_position=0 WHERE status='queued'").run();
    }
  }

  #jobByOwner(ownerId: string, jobId: string): JobRow | undefined {
    return this.#database
      .prepare(`${jobSelect()} WHERE owner_id = ? AND id = ?`)
      .get(ownerId, jobId) as JobRow | undefined;
  }
}
