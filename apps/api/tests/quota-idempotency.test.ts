import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrationSql } from "../src/db/migrate.js";
import { canonicalRequestShape, idempotencyKeyHmac } from "../src/jobs/idempotency.js";
import {
  JobAdmissionError,
  JobRepository,
  type ReservedAdmission,
} from "../src/jobs/jobRepository.js";

const databases: Database.Database[] = [];
const secret = "task8-idempotency-secret".repeat(3);
const start = Date.UTC(2026, 7, 21, 1, 2, 3);
const baseRequest = {
  inputBytes: 12,
  inputFormat: "docx",
  operation: "office.to.pdf",
  options: {},
  outputFormat: "pdf",
} as const;

function database(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(migrationSql("001_auth"));
  db.exec(migrationSql("002_jobs"));
  db.exec(migrationSql("003_job_admission"));
  db.exec(migrationSql("004_job_cleanup"));
  return db;
}

function repository(db = database(), now = start): JobRepository {
  return new JobRepository(db, { idempotencySecret: secret, now: () => now });
}

function reserve(
  repo: JobRepository,
  ownerId: string,
  key: string,
  request: unknown = baseRequest,
): ReservedAdmission {
  return repo.reserveAdmission({ idempotencyKey: key, ownerId, request });
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(JobAdmissionError);
    expect((error as JobAdmissionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("owner-scoped idempotency", () => {
  it("uses a domain-separated owner-scoped HMAC and a content-free canonical shape", () => {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const key = "repeatable-request-key-0001";

    const first = idempotencyKeyHmac(secret, ownerA, key);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(idempotencyKeyHmac(secret, ownerA, key)).toBe(first);
    expect(idempotencyKeyHmac(secret, ownerB, key)).not.toBe(first);
    expect(first).not.toContain(key);

    const shape = canonicalRequestShape(baseRequest);
    expect(shape).toBe(
      '{"operation":"office.to.pdf","inputFormat":"docx","outputFormat":"pdf","inputBytes":12,"options":{}}',
    );
    expect(shape).not.toContain("filename");
    expect(shape).not.toContain("sentinel");
  });

  it("canonicalizes allowlisted options in fixed order without trusting JSON prototypes", () => {
    canonicalRequestShape({
      inputBytes: 50,
      inputFormat: "opentrad",
      operation: "bid.assemble",
      options: {
        templateId: "bid.government.goods.v1",
        templateVersion: "1.0.0",
      },
      outputFormat: "pdf",
    });
    const original = Object.getOwnPropertyDescriptor(JSON, "stringify");
    try {
      Object.defineProperty(JSON, "stringify", {
        configurable: true,
        value: () => {
          throw new Error("poisoned JSON");
        },
      });
      expect(
        canonicalRequestShape({
          inputBytes: 50,
          inputFormat: "opentrad",
          operation: "bid.assemble",
          options: {
            templateVersion: "1.0.0",
            templateId: "bid.government.goods.v1",
          },
          outputFormat: "pdf",
        }),
      ).toBe(
        '{"operation":"bid.assemble","inputFormat":"opentrad","outputFormat":"pdf","inputBytes":50,"options":{"templateId":"bid.government.goods.v1","templateVersion":"1.0.0"}}',
      );
    } finally {
      if (original) Object.defineProperty(JSON, "stringify", original);
    }

    const hostileOptions = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileOptions, "language", {
      enumerable: true,
      get: () => "chi_sim",
    });
    expect(() =>
      canonicalRequestShape({
        inputBytes: 10,
        inputFormat: "pdf",
        operation: "ocr.pdf",
        options: hostileOptions,
        outputFormat: "txt",
      }),
    ).toThrow();
  });

  it("replays the same owner/key/shape and conflicts without changing quotas", () => {
    const db = database();
    const repo = repository(db);
    const owner = randomUUID();
    const key = "repeatable-request-key-0002";
    const first = reserve(repo, owner, key);
    const replay = reserve(repo, owner, key);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ job: first.job, replayed: true });
    expectCode(
      () =>
        reserve(repo, owner, key, {
          ...baseRequest,
          inputBytes: 13,
        }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(db.prepare("SELECT accepted_count FROM daily_usage").get()).toEqual({
      accepted_count: 1,
    });
    expect(db.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 1 });
  });

  it("isolates identical plaintext keys across owners", () => {
    const db = database();
    const repo = repository(db);
    const key = "repeatable-request-key-0003";
    const first = reserve(repo, randomUUID(), key);
    expect(repo.markRunning(first.job.id)).toBe(true);
    const second = reserve(repo, randomUUID(), key);

    expect(second.job.id).not.toBe(first.job.id);
    const rows = db
      .prepare("SELECT owner_id, key_hmac, request_shape FROM idempotency ORDER BY owner_id")
      .all() as Array<Record<string, string>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.key_hmac).not.toBe(rows[1]?.key_hmac);
    expect(JSON.stringify(rows)).not.toContain(key);
  });
});

describe("transactional admission quotas", () => {
  it("allows only one active job per owner", () => {
    const repo = repository();
    const owner = randomUUID();
    reserve(repo, owner, "repeatable-request-key-1001");
    expectCode(() => reserve(repo, owner, "repeatable-request-key-1002"), "JOB_ALREADY_ACTIVE");
  });

  it("allows at most one running plus one queued globally", () => {
    const repo = repository();
    const first = reserve(repo, randomUUID(), "repeatable-request-key-2001");
    expect(repo.markRunning(first.job.id)).toBe(true);
    const second = reserve(repo, randomUUID(), "repeatable-request-key-2002");
    expect(second.job.queuePosition).toBe(1);
    expectCode(() => reserve(repo, randomUUID(), "repeatable-request-key-2003"), "QUEUE_FULL");
  });

  it("moves the sole queued job from position one to zero when running terminates", () => {
    const repo = repository();
    const first = reserve(repo, randomUUID(), "repeatable-request-key-2101");
    expect(repo.markRunning(first.job.id)).toBe(true);
    const secondOwner = randomUUID();
    const second = reserve(repo, secondOwner, "repeatable-request-key-2102");
    expect(second.job.queuePosition).toBe(1);

    expect(repo.markTerminal(first.job.id, "cancelled")).toBe(true);
    expect(repo.findOwnedJob(secondOwner, second.job.id)?.queuePosition).toBe(0);
  });

  it("lets a cancellation CAS defeat a stale success terminalization", () => {
    const db = database();
    const repo = repository(db);
    const owner = randomUUID();
    const admission = reserve(repo, owner, "cancel-success-race-request-key-0001");
    expect(repo.markRunning(admission.job.id)).toBe(true);
    expect(repo.workerJobState(admission.job.id)).toEqual({
      cancelRequested: false,
      status: "running",
    });

    expect(repo.cancelOwnedJob(owner, admission.job.id)?.job.status).toBe("cancelling");
    expect(
      repo.markTerminal(admission.job.id, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(false);
    expect(
      db
        .prepare("SELECT status, cancel_requested, result_media_type FROM jobs WHERE id=?")
        .get(admission.job.id),
    ).toEqual({ cancel_requested: 1, result_media_type: null, status: "cancelling" });
  });

  it("does not retrofit cancellation after success wins the terminal CAS", () => {
    const db = database();
    const repo = repository(db);
    const owner = randomUUID();
    const admission = reserve(repo, owner, "success-cancel-race-request-key-0001");
    expect(repo.markRunning(admission.job.id)).toBe(true);
    expect(
      repo.markTerminal(admission.job.id, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(true);

    expect(repo.cancelOwnedJob(owner, admission.job.id)?.job.status).toBe("succeeded");
    expect(
      db
        .prepare("SELECT status, cancel_requested, result_media_type FROM jobs WHERE id=?")
        .get(admission.job.id),
    ).toEqual({
      cancel_requested: 0,
      result_media_type: "application/pdf",
      status: "succeeded",
    });
  });

  it("counts at most ten accepted jobs per owner and UTC day", () => {
    const db = database();
    const repo = repository(db);
    const owner = randomUUID();
    for (let index = 0; index < 10; index += 1) {
      const admission = reserve(repo, owner, `daily-request-key-${String(index).padStart(4, "0")}`);
      repo.markTerminal(admission.job.id, "cancelled");
    }
    expectCode(() => reserve(repo, owner, "daily-request-key-0010"), "DAILY_QUOTA_EXCEEDED");
    expect(db.prepare("SELECT accepted_count FROM daily_usage").get()).toEqual({
      accepted_count: 10,
    });
  });

  it("fully rolls back job, idempotency, daily usage, and capacity", () => {
    const db = database();
    const repo = repository(db);
    const owner = randomUUID();
    const admission = reserve(repo, owner, "rollback-request-key-0001");
    expect(repo.rollbackAdmission(admission.job.id, owner)).toBe(true);

    expect(db.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM idempotency").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM daily_usage").get()).toEqual({ count: 0 });
    expect(reserve(repo, owner, "rollback-request-key-0001").replayed).toBe(false);
  });

  it("expires admission state after exactly fifteen minutes without refunding accepted usage", () => {
    const db = database();
    let now = start;
    const repo = new JobRepository(db, { idempotencySecret: secret, now: () => now });
    const owner = randomUUID();
    const admission = reserve(repo, owner, "expiry-request-key-0001");
    expect(admission.job.expiresAt).toBe(new Date(start + 15 * 60_000).toISOString());

    now += 15 * 60_000;
    const claim = repo.claimExpiredCleanup(1)[0];
    expect(claim?.jobId).toBe(admission.job.id);
    expect(repo.findOwnedJob(owner, admission.job.id)).toBeDefined();
    expect(repo.completeCleanup(admission.job.id, claim?.token ?? "")).toBe(true);
    expect(repo.findOwnedJob(owner, admission.job.id)).toBeUndefined();
    expect(db.prepare("SELECT accepted_count FROM daily_usage").get()).toEqual({
      accepted_count: 1,
    });
  });

  it("claims expired cleanup durably and deletes the row only after file cleanup completes", () => {
    const db = database();
    let now = start;
    const repo = new JobRepository(db, { idempotencySecret: secret, now: () => now });
    const owner = randomUUID();
    const admission = reserve(repo, owner, "durable-expiry-request-key-0001");
    now += 15 * 60_000;

    const firstClaim = repo.claimExpiredCleanup(1)[0];
    expect(firstClaim).toMatchObject({ jobId: admission.job.id, kind: "expiry" });
    expect(
      db.prepare("SELECT count(*) AS count FROM jobs WHERE id=?").get(admission.job.id),
    ).toEqual({ count: 1 });
    expect(repo.releaseCleanupClaim(admission.job.id, firstClaim?.token ?? "")).toBe(true);

    const retry = repo.claimExpiredCleanup(1)[0];
    expect(retry?.jobId).toBe(admission.job.id);
    expect(repo.completeCleanup(admission.job.id, retry?.token ?? "")).toBe(true);
    expect(
      db.prepare("SELECT count(*) AS count FROM jobs WHERE id=?").get(admission.job.id),
    ).toEqual({ count: 0 });
    expect(db.prepare("SELECT accepted_count FROM daily_usage").get()).toEqual({
      accepted_count: 1,
    });
  });

  it("does not expose a consumed result as ready and resists poisoned Array.map during cleanup", () => {
    const db = database();
    let now = start;
    const repo = new JobRepository(db, { idempotencySecret: secret, now: () => now });
    const owner = randomUUID();
    const admission = reserve(repo, owner, "result-request-key-0001");
    expect(
      repo.markTerminal(admission.job.id, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(true);
    const claim = repo.claimResult(owner, admission.job.id);
    expect(claim).toBeDefined();
    const cleanup = repo.beginResultCleanup(owner, admission.job.id, claim?.token ?? "");
    expect(cleanup).toBeDefined();
    expect(repo.completeCleanup(admission.job.id, cleanup?.token ?? "")).toBe(true);
    expect(repo.findOwnedJob(owner, admission.job.id)).toBeUndefined();

    const expiring = reserve(repo, randomUUID(), "expiry-request-key-0002");
    expect(repo.markRunning(expiring.job.id)).toBe(true);
    const cancellingOwner = randomUUID();
    const cancelling = reserve(repo, cancellingOwner, "cancel-cleanup-request-key-0001");
    expect(repo.markQueued(cancelling.job.id)).toBe(true);
    expect(repo.cancelOwnedJob(cancellingOwner, cancelling.job.id)?.cleanupFiles).toBe(true);
    now += 15 * 60_000;
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "map");
    try {
      Object.defineProperty(Array.prototype, "map", {
        configurable: true,
        value: () => {
          throw new Error("poisoned map");
        },
      });
      const pending = repo.claimPendingCleanup(1)[0];
      expect(pending?.jobId).toBe(cancelling.job.id);
      expect(repo.completeCleanup(cancelling.job.id, pending?.token ?? "")).toBe(true);
      let foundExpiring = false;
      for (let batch = 0; batch < 2; batch += 1) {
        const expiries = repo.claimExpiredCleanup(2);
        for (let index = 0; index < expiries.length; index += 1) {
          const expiry = expiries[index];
          if (!expiry) continue;
          if (expiry.jobId === expiring.job.id) foundExpiring = true;
          expect(repo.completeCleanup(expiry.jobId, expiry.token)).toBe(true);
        }
        if (expiries.length < 2) break;
      }
      expect(foundExpiring).toBe(true);
    } finally {
      if (original) Object.defineProperty(Array.prototype, "map", original);
    }
  });

  it("leases result claims for five minutes and fences every stale token", () => {
    const db = database();
    let now = start;
    const repo = new JobRepository(db, { idempotencySecret: secret, now: () => now });
    const owner = randomUUID();
    const admission = reserve(repo, owner, "leased-result-request-key-0001");
    expect(
      repo.markTerminal(admission.job.id, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(true);

    const first = repo.claimResult(owner, admission.job.id);
    expect(first).toBeDefined();
    now += 5 * 60_000 - 1;
    expect(repo.claimResult(owner, admission.job.id)).toBeUndefined();
    now += 1;
    const reclaimed = repo.claimResult(owner, admission.job.id);
    expect(reclaimed).toBeDefined();
    expect(reclaimed?.token).not.toBe(first?.token);
    expect(repo.releaseResultClaim(owner, admission.job.id, first?.token ?? "")).toBe(false);
    expect(repo.beginResultCleanup(owner, admission.job.id, first?.token ?? "")).toBeUndefined();
    const cleanup = repo.beginResultCleanup(owner, admission.job.id, reclaimed?.token ?? "");
    expect(cleanup).toBeDefined();
    expect(repo.completeCleanup(admission.job.id, cleanup?.token ?? "")).toBe(true);
  });

  it("rejects hostile or extended repository option snapshots", () => {
    const db = database();
    expect(
      () =>
        new JobRepository(db, {
          idempotencySecret: secret,
          now: () => start,
          extra: true,
        } as never),
    ).toThrow("JOB_REPOSITORY_INVALID");

    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "idempotencySecret", {
      enumerable: true,
      get: () => secret,
    });
    expect(() => new JobRepository(db, hostile as never)).toThrow("JOB_REPOSITORY_INVALID");
  });

  it("rejects admission when the authenticated owner was concurrently deleted", () => {
    const db = database();
    const ownerId = randomUUID();
    db.prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, username)
       VALUES (?, 'owner', ?, 0, 1, 1, 'deleted_owner')`,
    ).run(ownerId, `${ownerId}@users.opentrad.invalid`);
    const repo = new JobRepository(db, {
      idempotencySecret: secret,
      now: () => start,
      requireOwnerExists: true,
    });
    db.prepare("DELETE FROM user WHERE id = ?").run(ownerId);

    expectCode(() => reserve(repo, ownerId, "deleted-owner-idempotency-key-0001"), "AUTH_REQUIRED");
    expect(db.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM idempotency").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM daily_usage").get()).toEqual({ count: 0 });
  });
});
