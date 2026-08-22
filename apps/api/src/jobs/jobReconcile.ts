import type { JobErrorCode } from "@opentrad/contracts";
import type { JobFiles, WorkerCompletion } from "./jobFiles.js";
import type { JobRepository, WorkerJobState } from "./jobRepository.js";

const RECONCILE_BATCH = 32;
const intrinsicClearInterval = clearInterval;
const intrinsicSetInterval = setInterval;

export interface JobReconciliationRuntime {
  readonly files: Pick<
    JobFiles,
    | "claimWorkerCompletion"
    | "completeWorkerReconciliation"
    | "destroy"
    | "exists"
    | "listRunningJobIds"
    | "listWorkerCompletionIds"
    | "prepareWorkerTerminal"
    | "publishResult"
    | "requestCancellation"
    | "resultSize"
  >;
  readonly repository: Pick<
    JobRepository,
    | "markRunning"
    | "markTerminal"
    | "pendingCancellationJobIds"
    | "workerJobState"
    | "workerTerminalState"
  >;
}

export interface JobReconciliationOptions {
  readonly clearInterval?: (timer: NodeJS.Timeout) => void;
  readonly intervalMs?: number;
  readonly setInterval?: (run: () => void, milliseconds: number) => NodeJS.Timeout;
}

export interface JobReconciliationController {
  readonly idle: () => Promise<void>;
  readonly stop: () => void;
}

function terminalDetails(
  completion: WorkerCompletion,
):
  | { readonly errorCode: JobErrorCode; readonly retryable: boolean }
  | { readonly mediaType: string; readonly resultBytes: number }
  | undefined {
  if (completion.status === "failed") {
    return { errorCode: completion.errorCode, retryable: completion.retryable };
  }
  if (completion.status === "succeeded") {
    return { mediaType: completion.mediaType, resultBytes: completion.resultBytes };
  }
  return undefined;
}

async function reconcileCompletion(
  runtime: JobReconciliationRuntime,
  completion: WorkerCompletion,
  state: WorkerJobState | undefined,
): Promise<void> {
  const cancelled = state?.cancelRequested === true || completion.status === "cancelled";
  if (state === undefined) {
    const terminal = runtime.repository.workerTerminalState(completion.jobId);
    if (terminal?.status === "succeeded") {
      if (
        completion.status !== "succeeded" ||
        terminal.mediaType !== completion.mediaType ||
        terminal.resultBytes !== completion.resultBytes ||
        (await runtime.files.resultSize(completion.jobId)) !== completion.resultBytes
      ) {
        throw new Error("JOB_RECONCILIATION_INVALID");
      }
      await runtime.files.completeWorkerReconciliation(completion.jobId);
      return;
    }
    await runtime.files.prepareWorkerTerminal(completion);
    await runtime.files.completeWorkerReconciliation(completion.jobId);
    return;
  }
  if (cancelled) {
    await runtime.files.prepareWorkerTerminal(completion);
    if (runtime.repository.markTerminal(completion.jobId, "cancelled")) {
      await runtime.files.completeWorkerReconciliation(completion.jobId);
    }
    return;
  }
  if (completion.status === "succeeded") {
    await runtime.files.publishResult({
      jobId: completion.jobId,
      resultBytes: completion.resultBytes,
    });
    if (
      runtime.repository.markTerminal(completion.jobId, "succeeded", terminalDetails(completion))
    ) {
      await runtime.files.completeWorkerReconciliation(completion.jobId);
      return;
    }
    const latest = runtime.repository.workerJobState(completion.jobId);
    if (latest?.cancelRequested === true) {
      await runtime.files.prepareWorkerTerminal(completion);
      if (runtime.repository.markTerminal(completion.jobId, "cancelled")) {
        await runtime.files.completeWorkerReconciliation(completion.jobId);
      }
    }
    return;
  }
  await runtime.files.prepareWorkerTerminal(completion);
  if (
    runtime.repository.markTerminal(
      completion.jobId,
      completion.status,
      terminalDetails(completion),
    )
  ) {
    await runtime.files.completeWorkerReconciliation(completion.jobId);
  }
}

export async function runJobReconciliation(runtime: JobReconciliationRuntime): Promise<void> {
  const running = await runtime.files.listRunningJobIds(RECONCILE_BATCH);
  for (let index = 0; index < running.length; index += 1) {
    const jobId = running[index];
    if (jobId) runtime.repository.markRunning(jobId);
  }
  const cancellations = runtime.repository.pendingCancellationJobIds(RECONCILE_BATCH);
  for (let index = 0; index < cancellations.length; index += 1) {
    const jobId = cancellations[index];
    if (!jobId) continue;
    try {
      await runtime.files.requestCancellation(jobId);
    } catch {
      if (!(await runtime.files.exists(jobId))) runtime.repository.markTerminal(jobId, "cancelled");
    }
  }
  const completions = await runtime.files.listWorkerCompletionIds(RECONCILE_BATCH);
  for (let index = 0; index < completions.length; index += 1) {
    const jobId = completions[index];
    if (!jobId) continue;
    try {
      const completion = await runtime.files.claimWorkerCompletion(jobId);
      let state = runtime.repository.workerJobState(jobId);
      if (state?.status === "queued") {
        if (!runtime.repository.markRunning(jobId)) continue;
        state = runtime.repository.workerJobState(jobId);
        if (state?.status === "queued") continue;
      }
      await reconcileCompletion(runtime, completion, state);
    } catch {
      // A later bounded tick retries the exact private completion.
    }
  }
}

export async function startJobReconciliation(
  runtime: JobReconciliationRuntime,
  options: JobReconciliationOptions = {},
): Promise<JobReconciliationController> {
  const intervalMs = options.intervalMs ?? 1_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) {
    throw new Error("JOB_RECONCILIATION_INVALID");
  }
  const setTimer = options.setInterval ?? intrinsicSetInterval;
  const clearTimer = options.clearInterval ?? intrinsicClearInterval;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = runJobReconciliation(runtime)
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
