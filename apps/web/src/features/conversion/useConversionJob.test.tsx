import { type JobStatus, JobStatusSchema } from "@opentrad/contracts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type ServerConversionServices, useConversionJob } from "./useConversionJob";

const base = {
  createdAt: "2026-08-22T00:00:00.000Z",
  expiresAt: "2026-08-22T00:15:00.000Z",
  id: "00000000-0000-4000-8000-000000000014",
  operation: "office.to.pdf" as const,
  quality: "B" as const,
};
const queued = JobStatusSchema.parse({
  ...base,
  progress: { completed: 0, phase: "queued", total: 1 },
  queuePosition: 1,
  status: "queued",
});
const running = JobStatusSchema.parse({
  ...base,
  progress: { completed: 1, phase: "converting", total: 2 },
  startedAt: "2026-08-22T00:00:01.000Z",
  status: "running",
});
const succeeded = JobStatusSchema.parse({
  ...base,
  result: { mediaType: "application/pdf", ready: true, sizeBytes: 5 },
  startedAt: "2026-08-22T00:00:01.000Z",
  status: "succeeded",
});
const cancelling = JobStatusSchema.parse({
  ...base,
  progress: { completed: 0, phase: "queued", total: 1 },
  status: "cancelling",
});
const cancelled = JobStatusSchema.parse({ ...base, status: "cancelled" });

const request = {
  inputBytes: 7,
  inputFormat: "docx" as const,
  operation: "office.to.pdf" as const,
  options: {},
  outputFormat: "pdf" as const,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("polls every 1.5 seconds, retries a transient read failure, and stops at success", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn<ServerConversionServices["read"]>()
    .mockRejectedValueOnce(new Error("private transport details"))
    .mockResolvedValueOnce(running)
    .mockResolvedValueOnce(succeeded);
  const services: ServerConversionServices = {
    cancel: vi.fn(async () => queued),
    download: vi.fn(async () => undefined),
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
    read,
    submit: vi.fn(async () => queued),
  };
  const { result, unmount } = renderHook(() => useConversionJob(services));

  await act(async () => {
    await result.current.submit(request, new File(["private"], "private.docx"));
  });
  expect(result.current.job).toEqual(queued);

  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(result.current.error).toBe("无法刷新任务状态，请稍后重试");
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(result.current.job).toEqual(running);
  expect(result.current.error).toBe("");
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(result.current.job).toEqual(succeeded);
  expect(read).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  unmount();
});

it("continues polling from cancelling to cancelled", async () => {
  vi.useFakeTimers();
  const services: ServerConversionServices = {
    cancel: vi.fn(async () => cancelling),
    download: vi.fn(async () => undefined),
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
    read: vi.fn(async () => cancelled),
    submit: vi.fn(async () => queued),
  };
  const { result } = renderHook(() => useConversionJob(services));
  await act(async () => {
    await result.current.submit(request, new File(["private"], "private.docx"));
  });
  await act(async () => result.current.cancel());
  expect(result.current.job).toEqual(cancelling);

  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(result.current.job).toEqual(cancelled);
  expect(services.read).toHaveBeenCalledTimes(1);
});

it("aborts an in-flight poll when the component unmounts", async () => {
  vi.useFakeTimers();
  let pollSignal: AbortSignal | undefined;
  const services: ServerConversionServices = {
    cancel: vi.fn(async () => cancelled),
    download: vi.fn(async () => undefined),
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
    read: vi.fn((_id, signal) => {
      pollSignal = signal;
      return new Promise<JobStatus>(() => undefined);
    }),
    submit: vi.fn(async () => queued),
  };
  const { result, unmount } = renderHook(() => useConversionJob(services));
  await act(async () => {
    await result.current.submit(request, new File(["private"], "private.docx"));
  });
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(pollSignal?.aborted).toBe(false);
  unmount();
  expect(pollSignal?.aborted).toBe(true);
});
