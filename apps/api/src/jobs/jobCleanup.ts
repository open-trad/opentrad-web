import type { JobFiles } from "./jobFiles.js";
import type { JobRepository } from "./jobRepository.js";

const CLEANUP_BATCH = 32;
const ORPHAN_MAX_AGE_MS = 15 * 60_000;
const intrinsicClearInterval = clearInterval;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicReflectApply = Reflect.apply;
const intrinsicSetInterval = setInterval;

export interface JobCleanupRuntime {
  readonly files: Pick<JobFiles, "cleanupOrphanStaging" | "destroy">;
  readonly repository: Pick<
    JobRepository,
    "claimExpiredCleanup" | "claimPendingCleanup" | "completeCleanup" | "releaseCleanupClaim"
  >;
}

export interface JobCleanupSchedulerOptions {
  readonly intervalMs?: number;
  readonly setInterval?: (run: () => void, milliseconds: number) => NodeJS.Timeout;
  readonly clearInterval?: (timer: NodeJS.Timeout) => void;
}

export interface JobCleanupController {
  readonly idle: () => Promise<void>;
  readonly stop: () => void;
}

export async function runJobCleanup(runtime: JobCleanupRuntime): Promise<void> {
  const claims = [] as Array<ReturnType<JobRepository["claimPendingCleanup"]>[number]>;
  const pending = runtime.repository.claimPendingCleanup(CLEANUP_BATCH);
  for (let index = 0; index < pending.length; index += 1) {
    const claim = pending[index];
    if (claim) intrinsicReflectApply(intrinsicArrayPush, claims, [claim]);
  }
  const remaining = CLEANUP_BATCH - claims.length;
  if (remaining > 0) {
    const expired = runtime.repository.claimExpiredCleanup(remaining);
    for (let index = 0; index < expired.length; index += 1) {
      const claim = expired[index];
      if (claim) intrinsicReflectApply(intrinsicArrayPush, claims, [claim]);
    }
  }
  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index];
    if (!claim) continue;
    try {
      await runtime.files.destroy(claim.jobId);
      if (!runtime.repository.completeCleanup(claim.jobId, claim.token)) {
        runtime.repository.releaseCleanupClaim(claim.jobId, claim.token);
      }
    } catch {
      runtime.repository.releaseCleanupClaim(claim.jobId, claim.token);
    }
  }
  try {
    await runtime.files.cleanupOrphanStaging(ORPHAN_MAX_AGE_MS);
  } catch {
    // A later bounded tick retries cleanup without exposing filesystem details.
  }
}

export async function startJobCleanup(
  runtime: JobCleanupRuntime,
  options: JobCleanupSchedulerOptions = {},
): Promise<JobCleanupController> {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60 * 60_000) {
    throw new Error("JOB_CLEANUP_INVALID");
  }
  const setTimer = options.setInterval ?? intrinsicSetInterval;
  const clearTimer = options.clearInterval ?? intrinsicClearInterval;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = runJobCleanup(runtime)
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
      });
    void inFlight.catch(() => undefined);
  };
  run();
  await inFlight;
  const timer = setTimer(run, intervalMs);
  return Object.freeze({
    idle: async () => {
      await inFlight;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimer(timer);
    },
  });
}
