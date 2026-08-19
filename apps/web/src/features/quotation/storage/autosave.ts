import { parseDocumentDraft, type StandardGoodsQuoteDraft } from "@opentrad/document-core";

export type AutosaveStatus =
  | { state: "saving"; requestRevision: number }
  | { state: "saved"; requestRevision: number }
  | {
      state: "error";
      requestRevision: number;
      code: "SAVE_FAILED";
      message: "草稿保存失败，请检查浏览器存储空间后重试";
    };

interface AutosaveJob {
  requestRevision: number;
  snapshot: StandardGoodsQuoteDraft;
  ready: boolean;
}

export interface AutosaveCoordinator {
  schedule(input: unknown): number;
  flush(): Promise<void>;
  dispose(): void;
}

export function createAutosaveCoordinator(options: {
  delayMs: number;
  save: (draft: StandardGoodsQuoteDraft) => Promise<unknown>;
  onStatus?: (status: AutosaveStatus) => void;
}): AutosaveCoordinator {
  let latestRevision = 0;
  let pending: AutosaveJob | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> | undefined;
  let disposed = false;

  function emit(status: AutosaveStatus): void {
    options.onStatus?.(status);
  }

  async function drain(): Promise<void> {
    while (pending?.ready) {
      const job = pending;
      pending = undefined;
      emit({ state: "saving", requestRevision: job.requestRevision });
      try {
        await options.save(job.snapshot);
        if (!disposed && job.requestRevision === latestRevision && !pending) {
          emit({ state: "saved", requestRevision: job.requestRevision });
        }
      } catch {
        if (!disposed && job.requestRevision === latestRevision && !pending) {
          emit({
            state: "error",
            requestRevision: job.requestRevision,
            code: "SAVE_FAILED",
            message: "草稿保存失败，请检查浏览器存储空间后重试",
          });
        }
      }
    }
  }

  function startDrain(): Promise<void> {
    if (!draining) {
      draining = drain().finally(() => {
        draining = undefined;
        if (pending?.ready) {
          void startDrain();
        }
      });
    }
    return draining;
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    schedule(input) {
      if (disposed) {
        throw new Error("Autosave coordinator is disposed");
      }
      const snapshot = parseDocumentDraft(input);
      latestRevision += 1;
      const job: AutosaveJob = { requestRevision: latestRevision, snapshot, ready: false };
      pending = job;
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        if (pending === job) {
          job.ready = true;
          void startDrain();
        }
      }, options.delayMs);
      return latestRevision;
    },

    async flush() {
      clearTimer();
      if (pending) {
        pending.ready = true;
        void startDrain();
      }
      while (draining) {
        const active = draining;
        await active;
        if (draining === active) {
          break;
        }
      }
    },

    dispose() {
      disposed = true;
      clearTimer();
      pending = undefined;
    },
  };
}
