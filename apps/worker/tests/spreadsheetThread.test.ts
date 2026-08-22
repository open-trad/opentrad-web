import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { __spreadsheetTest, SPREADSHEET_POLICY } from "../src/adapters/spreadsheet.js";

class FakeThread extends EventEmitter {
  posted?: unknown;
  transfer?: readonly ArrayBuffer[];
  terminated = 0;
  throwOnPost = false;

  postMessage(message: unknown, transfer: readonly ArrayBuffer[]): void {
    if (this.throwOnPost) throw new Error("private fake failure");
    this.posted = message;
    this.transfer = transfer;
  }

  terminate(): Promise<number> {
    this.terminated += 1;
    return Promise.resolve(0);
  }
}

class HostileOffThread extends FakeThread {
  readonly offAttempts: string[] = [];

  override off(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    this.offAttempts.push(String(eventName));
    if (this.offAttempts.length === 1) throw new Error("private off failure");
    return super.off(eventName, listener);
  }
}

interface FakeTimer {
  readonly callback: () => void;
  readonly delay: number;
  cleared: boolean;
}

function harness(thread = new FakeThread()) {
  const timers: FakeTimer[] = [];
  const creations: Array<{ readonly url: URL; readonly options: unknown }> = [];
  const runtime = {
    createThread(url: URL, options: unknown) {
      creations.push({ url, options });
      return thread;
    },
    setTimer(callback: () => void, delay: number) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer: FakeTimer) {
      timer.cleared = true;
    },
  };
  return {
    convert: __spreadsheetTest.createAdapter(runtime),
    creations,
    runtime,
    thread,
    timers,
  };
}

function request(input: Uint8Array<ArrayBufferLike> = new Uint8Array([0x50, 0x4b, 1, 2, 3])) {
  return {
    input,
    inputFormat: "xlsx",
    outputFormat: "csv",
    options: { sheetIndex: 1 },
  };
}

function posted(thread: FakeThread): {
  readonly id: string;
  readonly kind: "spreadsheet.to.csv";
  readonly input: ArrayBuffer;
  readonly inputFormat: "xlsx";
  readonly outputFormat: "csv";
  readonly sheetIndex: number;
} {
  if (!thread.posted || typeof thread.posted !== "object") throw new Error("missing post");
  return thread.posted as ReturnType<typeof posted>;
}

function csv(value: string): ArrayBuffer {
  const body = new TextEncoder().encode(`${value}\r\n`);
  const output = new Uint8Array(body.byteLength + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(body, 3);
  return output.buffer;
}

function fixture(format: "xls" | "xlsx" | "ods"): Uint8Array {
  const path = fileURLToPath(new URL(`fixtures/spreadsheet.${format}.base64`, import.meta.url));
  return new Uint8Array(Buffer.from(readFileSync(path, "utf8").trim(), "base64"));
}

async function fixedFailure(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toThrow(code);
}

describe("spreadsheet worker-thread adapter", () => {
  it("copies and transfers caller bytes through the exact protocol under fixed resource limits", async () => {
    const test = harness();
    const source = new Uint8Array([0x50, 0x4b, 1, 2, 3]);
    const original = [...source];
    const pending = test.convert(request(source), new AbortController().signal);
    const message = posted(test.thread);

    expect(Reflect.ownKeys(message)).toEqual([
      "id",
      "kind",
      "input",
      "inputFormat",
      "outputFormat",
      "sheetIndex",
    ]);
    expect(message).toMatchObject({
      kind: "spreadsheet.to.csv",
      inputFormat: "xlsx",
      outputFormat: "csv",
      sheetIndex: 1,
    });
    expect(message.id).toMatch(/^spreadsheet-[1-9][0-9]*$/u);
    expect(message.input).not.toBe(source.buffer);
    expect([...new Uint8Array(message.input)]).toEqual(original);
    expect(test.thread.transfer).toEqual([message.input]);
    expect(source.byteLength).toBe(original.length);
    expect([...source]).toEqual(original);
    expect(test.creations).toHaveLength(1);
    expect(test.creations[0]?.url.pathname.endsWith("/threads/spreadsheetThread.js")).toBe(true);
    expect(test.creations[0]?.options).toEqual({
      argv: [],
      env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
      execArgv: [],
      name: "opentrad-spreadsheet",
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
      stderr: true,
      stdout: true,
    });
    expect(test.timers[0]?.delay).toBe(SPREADSHEET_POLICY.thread.timeoutMs);

    const output = csv("完成");
    test.thread.emit("message", { id: message.id, ok: true, output });
    const result = await pending;
    expect(new TextDecoder().decode(result.subarray(3))).toBe("完成\r\n");
    expect(test.timers[0]?.cleared).toBe(true);
    expect(test.thread.listenerCount("message")).toBe(0);
    expect(test.thread.listenerCount("error")).toBe(0);
    expect(test.thread.listenerCount("exit")).toBe(0);
    expect(test.thread.terminated).toBe(0);
  });

  it("rejects malformed requests and an already-aborted signal before creating a thread", async () => {
    const test = harness();
    const signal = new AbortController().signal;
    const invalid = [
      { ...request(), inputFormat: "csv" },
      { ...request(), outputFormat: "xlsx" },
      { ...request(), options: { sheetIndex: 256 } },
      { ...request(), options: { sheetIndex: 1, extra: true } },
      { ...request(), extra: true },
      { ...request(), input: Buffer.from([1, 2, 3]) },
      { ...request(), input: new Uint8Array() },
      { ...request(), input: new Uint8Array(25 * 1024 * 1024 + 1) },
    ];
    for (const value of invalid) {
      await fixedFailure(test.convert(value, signal), "CONVERSION_FAILED");
    }
    const controller = new AbortController();
    controller.abort();
    await fixedFailure(test.convert(request(), controller.signal), "JOB_CANCELLED");
    expect(test.creations).toHaveLength(0);
  });

  it("rejects shared, detached, and resizable byte sources at the intrinsic byte boundary", async () => {
    const sources: Uint8Array[] = [new Uint8Array(new SharedArrayBuffer(8))];

    const detachedBuffer = new ArrayBuffer(8);
    const detached = new Uint8Array(detachedBuffer);
    structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
    sources.push(detached);

    const resize = Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value;
    if (typeof resize === "function") {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        length: number,
        options: { readonly maxByteLength: number },
      ) => ArrayBuffer;
      sources.push(new Uint8Array(new ResizableArrayBuffer(8, { maxByteLength: 16 })));
    }

    for (const source of sources) {
      const test = harness();
      const pending = test.convert(request(source), new AbortController().signal);
      if (test.timers[0]) test.timers[0].callback();
      await fixedFailure(pending, "CONVERSION_FAILED");
      expect(test.creations).toHaveLength(0);
    }
  });

  it("ignores shadow byte getters and typed-array prototype or constructor poisoning", async () => {
    const test = harness();
    const IntrinsicUint8Array = Uint8Array;
    const source = new IntrinsicUint8Array([0x50, 0x4b, 1, 2, 3]);
    const expected = [...source];
    Object.defineProperties(source, {
      buffer: {
        get: () => {
          throw new Error("private shadow buffer");
        },
      },
      byteLength: { get: () => 0 },
      byteOffset: {
        get: () => {
          throw new Error("private shadow offset");
        },
      },
    });
    const output = csv("intrinsic");
    const originalSet = Uint8Array.prototype.set;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Uint8Array");
    Uint8Array.prototype.set = function poisonedSet(): void {
      throw new Error("private prototype poison");
    };
    Object.defineProperty(globalThis, "Uint8Array", {
      configurable: true,
      writable: true,
      value: function PoisonedUint8Array(): never {
        throw new Error("private constructor poison");
      },
    });
    try {
      const pending = test.convert(request(source), new AbortController().signal);
      void pending.catch(() => undefined);
      expect(test.thread.posted).toBeDefined();
      const message = posted(test.thread);
      expect([...new IntrinsicUint8Array(message.input)]).toEqual(expected);
      test.thread.emit("message", { id: message.id, ok: true, output });
      expect(new TextDecoder().decode((await pending).subarray(3))).toBe("intrinsic\r\n");
    } finally {
      IntrinsicUint8Array.prototype.set = originalSet;
      if (constructorDescriptor) {
        Object.defineProperty(globalThis, "Uint8Array", constructorDescriptor);
      }
    }
  });

  it("accepts exact request fields independent of insertion order", async () => {
    const test = harness();
    const normal = request();
    const reordered = {
      options: normal.options,
      outputFormat: normal.outputFormat,
      inputFormat: normal.inputFormat,
      input: normal.input,
    };
    const pending = test.convert(reordered, new AbortController().signal);
    const message = posted(test.thread);
    test.thread.emit("message", { id: message.id, ok: true, output: csv("ok") });
    expect(new TextDecoder().decode((await pending).subarray(3))).toBe("ok\r\n");
  });

  it("terminates and cleans up on in-flight abort and the one absolute timeout", async () => {
    const aborted = harness();
    const controller = new AbortController();
    const abortPending = aborted.convert(request(), controller.signal);
    controller.abort();
    await fixedFailure(abortPending, "JOB_CANCELLED");
    expect(aborted.thread.terminated).toBe(1);
    expect(aborted.timers[0]?.cleared).toBe(true);
    expect(aborted.thread.listenerCount("message")).toBe(0);

    const timedOut = harness();
    const timeoutPending = timedOut.convert(request(), new AbortController().signal);
    const timer = timedOut.timers[0];
    if (!timer) throw new Error("missing timer");
    timer.callback();
    await fixedFailure(timeoutPending, "CONVERSION_TIMEOUT");
    expect(timedOut.thread.terminated).toBe(1);
    expect(timer.cleared).toBe(true);
  });

  it("attempts every listener cleanup independently when one off call throws", async () => {
    const thread = new HostileOffThread();
    const test = harness(thread);
    const pending = test.convert(request(), new AbortController().signal);
    test.timers[0]?.callback();
    await fixedFailure(pending, "CONVERSION_TIMEOUT");
    expect(thread.offAttempts).toEqual(["message", "error", "exit"]);
    expect(thread.terminated).toBe(1);
  });

  it("handles a synchronously firing timer without posting and clears its returned handle", async () => {
    const thread = new FakeThread();
    const handle = { cleared: false };
    const convert = __spreadsheetTest.createAdapter({
      createThread() {
        return thread;
      },
      setTimer(callback: () => void) {
        callback();
        return handle;
      },
      clearTimer(value: typeof handle) {
        expect(value).toBe(handle);
        value.cleared = true;
      },
    });

    const pending = convert(request(), new AbortController().signal);
    await fixedFailure(pending, "CONVERSION_TIMEOUT");
    expect(handle.cleared).toBe(true);
    expect(thread.posted).toBeUndefined();
    expect(thread.terminated).toBe(1);
  });

  it("maps timer setup failures and tolerates clearTimer failures without hanging", async () => {
    const setupThread = new FakeThread();
    const setupFailure = __spreadsheetTest.createAdapter({
      createThread() {
        return setupThread;
      },
      setTimer() {
        throw new Error("private timer setup failure");
      },
      clearTimer() {},
    });
    await fixedFailure(setupFailure(request(), new AbortController().signal), "CONVERSION_FAILED");
    expect(setupThread.posted).toBeUndefined();
    expect(setupThread.terminated).toBe(1);

    const clearThread = new FakeThread();
    const clearFailure = __spreadsheetTest.createAdapter({
      createThread() {
        return clearThread;
      },
      setTimer(callback: () => void, delay: number) {
        return { callback, delay };
      },
      clearTimer() {
        throw new Error("private timer clear failure");
      },
    });
    const pending = clearFailure(request(), new AbortController().signal);
    const message = posted(clearThread);
    clearThread.emit("message", { id: message.id, ok: true, output: csv("ok") });
    expect(new TextDecoder().decode((await pending).subarray(3))).toBe("ok\r\n");
  });

  it("closes the abort race between the initial check and listener attachment", async () => {
    const controller = new AbortController();
    const thread = new FakeThread();
    const timers: FakeTimer[] = [];
    const convert = __spreadsheetTest.createAdapter({
      createThread() {
        controller.abort();
        return thread;
      },
      setTimer(callback: () => void, delay: number) {
        const timer = { callback, delay, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer(timer: FakeTimer) {
        timer.cleared = true;
      },
    });

    const pending = convert(request(), controller.signal);
    await fixedFailure(pending, "JOB_CANCELLED");
    expect(thread.terminated).toBe(1);
    expect(thread.posted).toBeUndefined();
    expect(timers).toHaveLength(0);
  });

  it("maps error, early exit, post failure, id mismatch, and malformed messages to one fixed failure", async () => {
    const cases: Array<(test: ReturnType<typeof harness>, pending: Promise<unknown>) => void> = [
      (test) => test.thread.emit("error", new Error("private input name")),
      (test) => test.thread.emit("exit", 1),
      (test) => test.thread.emit("message", { id: "wrong", ok: true, output: csv("x") }),
      (test) => test.thread.emit("message", { id: posted(test.thread).id, ok: false }),
      (test) =>
        test.thread.emit("message", {
          id: posted(test.thread).id,
          ok: true,
          output: new ArrayBuffer(0),
        }),
    ];
    for (const trigger of cases) {
      const test = harness();
      const pending = test.convert(request(), new AbortController().signal);
      trigger(test, pending);
      await fixedFailure(pending, "CONVERSION_FAILED");
      expect(test.thread.terminated).toBe(1);
      expect(test.thread.listenerCount("message")).toBe(0);
    }

    const postFailure = harness();
    postFailure.thread.throwOnPost = true;
    await fixedFailure(
      postFailure.convert(request(), new AbortController().signal),
      "CONVERSION_FAILED",
    );
    expect(postFailure.thread.terminated).toBe(1);
  });

  it("settles once and ignores double, late, and post-timeout events", async () => {
    const test = harness();
    const pending = test.convert(request(), new AbortController().signal);
    const message = posted(test.thread);
    test.thread.emit("message", { id: message.id, ok: true, output: csv("first") });
    test.thread.emit("message", { id: message.id, ok: false, code: "CONVERSION_FAILED" });
    test.thread.emit("exit", 9);
    expect(new TextDecoder().decode((await pending).subarray(3))).toBe("first\r\n");
    expect(test.thread.terminated).toBe(0);

    const late = harness();
    const latePending = late.convert(request(), new AbortController().signal);
    const lateMessage = posted(late.thread);
    late.timers[0]?.callback();
    late.thread.emit("message", { id: lateMessage.id, ok: true, output: csv("late") });
    await fixedFailure(latePending, "CONVERSION_TIMEOUT");
    expect(late.thread.terminated).toBe(1);
  });

  it("uses an exact worker-side protocol and returns only fixed failures", () => {
    const valid = {
      id: "spreadsheet-999",
      kind: "spreadsheet.to.csv",
      input: fixture("xlsx").buffer,
      inputFormat: "xlsx",
      outputFormat: "csv",
      sheetIndex: 1,
    };
    const success = __spreadsheetTest.handleThreadMessage(valid, XLSX);
    expect(Reflect.ownKeys(success)).toEqual(["id", "ok", "output"]);
    expect(success.ok).toBe(true);
    if (!success.output) throw new Error("missing success output");
    expect(new TextDecoder().decode(new Uint8Array(success.output).subarray(3))).toBe(
      '中文,"逗号,""引号""","第一行\n第二行",3,1,2\r\n',
    );

    const failure = __spreadsheetTest.handleThreadMessage(
      { ...valid, input: new Uint8Array([1, 2, 3]).buffer },
      XLSX,
    );
    expect(failure).toEqual({ id: valid.id, ok: false, code: "CONVERSION_FAILED" });
    expect(Reflect.ownKeys(failure)).toEqual(["id", "ok", "code"]);
    expect(() => __spreadsheetTest.handleThreadMessage({ ...valid, extra: true }, XLSX)).toThrow(
      "CONVERSION_FAILED",
    );
  });
});
