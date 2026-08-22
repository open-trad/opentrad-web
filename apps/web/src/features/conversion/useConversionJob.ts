import type { CreateJobRequest, JobStatus } from "@opentrad/contracts";
import { useEffect, useRef, useState } from "react";

export interface ServerConversionServices {
  readonly cancel: (id: string, signal: AbortSignal) => Promise<JobStatus>;
  readonly download: (job: JobStatus, signal: AbortSignal) => Promise<void>;
  readonly randomUUID: () => string;
  readonly read: (id: string, signal: AbortSignal) => Promise<JobStatus>;
  readonly submit: (
    request: CreateJobRequest,
    file: File,
    idempotencyKey: string,
    signal: AbortSignal,
  ) => Promise<JobStatus>;
}

function terminal(job: JobStatus | null): boolean {
  return (
    job === null ||
    job.status === "succeeded" ||
    job.status === "failed" ||
    job.status === "cancelled"
  );
}

export function useConversionJob(services: ServerConversionServices) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const actionController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (busy || !job || terminal(job)) return;
    const jobId = job.id;
    const controller = new AbortController();
    const current = generation.current;
    let timer = 0;
    const poll = () => {
      void services
        .read(jobId, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted && generation.current === current) {
            setError("");
            setJob(next);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && generation.current === current) {
            setError("无法刷新任务状态，请稍后重试");
            timer = window.setTimeout(poll, 1_500);
          }
        });
    };
    timer = window.setTimeout(poll, 1_500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [busy, job, services]);

  useEffect(
    () => () => {
      generation.current += 1;
      actionController.current?.abort();
    },
    [],
  );

  async function submit(request: CreateJobRequest, file: File): Promise<void> {
    if (busy) return;
    generation.current += 1;
    const current = generation.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    setJob(null);
    try {
      const next = await services.submit(request, file, services.randomUUID(), controller.signal);
      if (!controller.signal.aborted && generation.current === current) setJob(next);
    } catch {
      if (!controller.signal.aborted && generation.current === current) {
        setError("服务器任务提交失败，请稍后重试");
      }
    } finally {
      if (generation.current === current) {
        actionController.current = null;
        setBusy(false);
      }
    }
  }

  async function cancel(): Promise<void> {
    if (!job || busy || terminal(job)) return;
    generation.current += 1;
    const current = generation.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await services.cancel(job.id, controller.signal);
      if (!controller.signal.aborted && generation.current === current) setJob(next);
    } catch {
      if (!controller.signal.aborted && generation.current === current) {
        setError("取消任务失败，请稍后重试");
      }
    } finally {
      if (generation.current === current) {
        actionController.current = null;
        setBusy(false);
      }
    }
  }

  async function download(): Promise<boolean> {
    if (!job || job.status !== "succeeded" || busy) return false;
    generation.current += 1;
    const current = generation.current;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    try {
      await services.download(job, controller.signal);
      if (!controller.signal.aborted && generation.current === current) {
        setJob(null);
        return true;
      }
    } catch {
      if (!controller.signal.aborted && generation.current === current) {
        setError("结果下载失败；未确认下载完成前可重试");
      }
    } finally {
      if (generation.current === current) {
        actionController.current = null;
        setBusy(false);
      }
    }
    return false;
  }

  function reset(): void {
    generation.current += 1;
    actionController.current?.abort();
    actionController.current = null;
    setBusy(false);
    setError("");
    setJob(null);
  }

  return { busy, cancel, download, error, job, reset, submit };
}
