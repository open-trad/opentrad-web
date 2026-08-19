import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AutosaveStatus, createAutosaveCoordinator } from "./autosave";

function draft(name: string): StandardGoodsQuoteDraft {
  const value = createStandardGoodsQuoteDraft({
    id: "autosave-draft",
    now: "2026-08-19T10:00:00.000Z",
  });
  value.seller.name = name;
  return value;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("quotation autosave coordinator", () => {
  it("validates and snapshots immediately before a debounced write", async () => {
    vi.useFakeTimers();
    const saved: StandardGoodsQuoteDraft[] = [];
    const coordinator = createAutosaveCoordinator({
      delayMs: 250,
      save: async (value) => {
        saved.push(value);
      },
    });
    const input = draft("第一次名称");

    coordinator.schedule(input);
    input.seller.name = "调用方后续修改";
    await vi.advanceTimersByTimeAsync(250);
    await coordinator.flush();

    expect(saved).toHaveLength(1);
    expect(saved[0]?.seller.name).toBe("第一次名称");
    expect(() => coordinator.schedule({ id: "invalid" })).toThrow();
    coordinator.dispose();
  });

  it("serializes writes and never reports a stale completion as saved", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const savedNames: string[] = [];
    const statuses: AutosaveStatus[] = [];
    let callCount = 0;
    const coordinator = createAutosaveCoordinator({
      delayMs: 10,
      save: async (value) => {
        callCount += 1;
        savedNames.push(value.seller.name);
        if (callCount === 1) {
          await firstWrite.promise;
        }
      },
      onStatus: (status) => statuses.push(status),
    });

    const firstRevision = coordinator.schedule(draft("旧快照"));
    await vi.advanceTimersByTimeAsync(10);
    const latestRevision = coordinator.schedule(draft("最新快照"));
    await vi.advanceTimersByTimeAsync(10);
    expect(savedNames).toEqual(["旧快照"]);

    firstWrite.resolve();
    await coordinator.flush();

    expect(savedNames).toEqual(["旧快照", "最新快照"]);
    expect(statuses.filter((status) => status.state === "saved")).toEqual([
      { state: "saved", requestRevision: latestRevision },
    ]);
    expect(firstRevision).toBeLessThan(latestRevision);
    coordinator.dispose();
  });

  it("collapses queued snapshots and exposes a finite failure state", async () => {
    vi.useFakeTimers();
    const savedNames: string[] = [];
    const statuses: AutosaveStatus[] = [];
    const coordinator = createAutosaveCoordinator({
      delayMs: 50,
      save: async (value) => {
        savedNames.push(value.seller.name);
        throw new Error(`must not leak ${value.seller.name}`);
      },
      onStatus: (status) => statuses.push(status),
    });

    coordinator.schedule(draft("被折叠"));
    const latest = coordinator.schedule(draft("最终内容"));
    await vi.advanceTimersByTimeAsync(50);
    await coordinator.flush();

    expect(savedNames).toEqual(["最终内容"]);
    expect(statuses.at(-1)).toEqual({
      state: "error",
      requestRevision: latest,
      code: "SAVE_FAILED",
      message: "草稿保存失败，请检查浏览器存储空间后重试",
    });
    coordinator.dispose();
  });

  it("never emits a completion after disposal while a save is still running", async () => {
    vi.useFakeTimers();
    const write = deferred();
    const statuses: AutosaveStatus[] = [];
    const coordinator = createAutosaveCoordinator({
      delayMs: 10,
      save: async () => write.promise,
      onStatus: (status) => statuses.push(status),
    });

    coordinator.schedule(draft("即将卸载的草稿"));
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses).toEqual([{ state: "saving", requestRevision: 1 }]);

    coordinator.dispose();
    write.resolve();
    await coordinator.flush();

    expect(statuses).toEqual([{ state: "saving", requestRevision: 1 }]);
  });
});
