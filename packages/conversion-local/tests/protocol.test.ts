import { describe, expect, it, vi } from "vitest";
import * as local from "../src/index.js";

const api = local as Record<string, unknown>;
const MiB = 1024 * 1024;

interface FakePost {
  readonly exactTransfer: boolean;
  readonly message: unknown;
  readonly transferredBuffer?: ArrayBuffer;
}

type Listener = EventListenerOrEventListenerObject;

function invoke(listener: Listener, event: Event): void {
  if (typeof listener === "function") listener(event);
  else listener.handleEvent(event);
}

class FakeWorker {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly posts: FakePost[] = [];
  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn((type: string, listener: Listener) => {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });
  readonly removeEventListener = vi.fn((type: string, listener: Listener) => {
    this.listeners.get(type)?.delete(listener);
  });
  readonly postMessage = vi.fn((message: unknown, transfer: Transferable[] = []) => {
    const bytes =
      message !== null && typeof message === "object"
        ? (message as { readonly bytes?: Uint8Array }).bytes
        : undefined;
    const transferredBuffer = transfer[0] instanceof ArrayBuffer ? transfer[0] : undefined;
    const exactTransfer =
      transfer.length === 1 && bytes instanceof Uint8Array && transferredBuffer === bytes.buffer;
    const cloned = structuredClone(message, { transfer });
    this.posts.push({ exactTransfer, message: cloned, transferredBuffer });
  });

  asWorker(): Worker {
    return this as unknown as Worker;
  }

  emit(type: "error" | "message" | "messageerror", event: Event): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const listener of listeners) invoke(listener, event);
  }

  emitMessage(data: unknown): void {
    this.emit("message", { data } as MessageEvent);
  }

  firstListener(type: string): Listener | undefined {
    return this.listeners.get(type)?.values().next().value;
  }

  listenerCount(): number {
    let total = 0;
    for (const listeners of this.listeners.values()) total += listeners.size;
    return total;
  }
}

class FakeWorkerScope {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly posts: FakePost[] = [];

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const bytes =
      message !== null && typeof message === "object"
        ? (message as { readonly bytes?: Uint8Array }).bytes
        : undefined;
    const transferredBuffer = transfer[0] instanceof ArrayBuffer ? transfer[0] : undefined;
    const exactTransfer =
      transfer.length === 1 && bytes instanceof Uint8Array && transferredBuffer === bytes.buffer;
    this.posts.push({
      exactTransfer,
      message: structuredClone(message, { transfer }),
      transferredBuffer,
    });
  }

  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
}

function request(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: crypto.randomUUID(),
    operation: "text.semantic",
    inputFormat: "txt",
    outputFormat: "md",
    bytes: new Uint8Array([65, 66, 67]),
    options: { encoding: "utf-8" },
    ...overrides,
  };
}

function aggregateRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: crypto.randomUUID(),
    kind: "aggregate",
    operation: "pdf.organize",
    outputFormat: "pdf",
    files: [
      { inputFormat: "pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
      { inputFormat: "pdf", bytes: new Uint8Array([37, 80, 68, 70, 45]) },
    ],
    options: {
      pagePlan: [
        { source: 1, page: 0, rotation: 90 },
        { source: 0, page: 0, rotation: 0 },
      ],
    },
    ...overrides,
  };
}

function success(id: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    ok: true,
    bytes: new Uint8Array([79, 75]),
    mediaType: "text/markdown",
    ...overrides,
  };
}

function client(worker: FakeWorker, timeoutMs = 120_000) {
  const LocalConversionClient = api.LocalConversionClient as new (
    createWorker: () => Worker,
    timeoutMs?: number,
  ) => {
    run(input: unknown, signal: AbortSignal): Promise<Record<string, unknown>>;
  };
  return new LocalConversionClient(() => worker.asWorker(), timeoutMs);
}

function parseRequest(input: unknown): Record<string, unknown> {
  return (api.parseLocalConversionRequest as (value: unknown) => Record<string, unknown>)(input);
}

function expectCleaned(worker: FakeWorker): void {
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.listenerCount()).toBe(0);
  expect(worker.removeEventListener).toHaveBeenCalledTimes(3);
}

describe("local conversion protocol", () => {
  it("publishes exact local byte limits", () => {
    const assertLocalFileLimit = api.assertLocalFileLimit as (
      operation: string,
      bytes: number,
    ) => void;
    for (const [operation, maximum] of [
      ["text.semantic", 10 * MiB],
      ["document.generate", 10 * MiB],
      ["docx.extract", 25 * MiB],
      ["pdf.inspect", 25 * MiB],
      ["pdf.organize", 25 * MiB],
      ["image.convert", 25 * MiB],
      ["images.to.pdf", 25 * MiB],
    ] as const) {
      expect(() => assertLocalFileLimit(operation, maximum)).not.toThrow();
      expect(() => assertLocalFileLimit(operation, maximum + 1)).toThrow("LOCAL_FILE_TOO_LARGE");
    }
    for (const operation of ["pdf.organize", "images.to.pdf"] as const) {
      expect(() => assertLocalFileLimit(operation, 40 * MiB)).toThrow("LOCAL_FILE_TOO_LARGE");
    }
    for (const bytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertLocalFileLimit("text.semantic", bytes)).toThrow("LOCAL_FILE_TOO_LARGE");
    }
    expect(() => assertLocalFileLimit("__proto__", 1)).toThrow("LOCAL_FILE_TOO_LARGE");
    expect(api.LOCAL_AGGREGATE_LIMITS).toEqual({
      "images.to.pdf": { maxFiles: 80, maxInputBytes: 25 * MiB, maxTotalBytes: 50 * MiB },
      "pdf.organize": {
        maxFiles: 20,
        maxInputBytes: 25 * MiB,
        maxPages: 200,
        maxTotalBytes: 50 * MiB,
      },
    });
    expect(Object.getPrototypeOf(api.LOCAL_AGGREGATE_LIMITS as object)).toBeNull();
    expect(Object.isFrozen(api.LOCAL_AGGREGATE_LIMITS)).toBe(true);
  });

  it("snapshots strict requests into frozen objects and tight byte arrays", () => {
    const source = new Uint8Array([9, 65, 66, 8]);
    const parsed = parseRequest(request({ bytes: source.subarray(1, 3) }));
    expect(parsed.bytes).toEqual(new Uint8Array([65, 66]));
    expect((parsed.bytes as Uint8Array).buffer).not.toBe(source.buffer);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(parsed.options as object)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.options)).toBe(true);
  });

  it("rejects unknown request fields and hostile options without invoking accessors", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "encoding", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "utf-8";
      },
    });
    const symbolOptions = { encoding: "utf-8", [Symbol("private")]: true };
    for (const hostile of [
      request({ sourceFilename: "private.txt" }),
      request({ options: { writer: "private" } }),
      request({ options: accessor }),
      request({ options: symbolOptions }),
      request({ options: new (class Options {})() }),
      request({ inputFormat: "pdf" }),
    ]) {
      expect(() => parseRequest(hostile)).toThrow("LOCAL_PROTOCOL_INVALID");
    }
    expect(getterCalls).toBe(0);
  });

  it("admits only output-specific PDF page render options", () => {
    expect(
      parseRequest(
        request({
          operation: "pdf.inspect",
          inputFormat: "pdf",
          outputFormat: "jpg",
          options: { pageNumber: 2, quality: 85, scale: 2 },
        }),
      ).options,
    ).toEqual({ pageNumber: 2, quality: 85, scale: 2 });
    for (const hostile of [
      request({
        operation: "pdf.inspect",
        inputFormat: "pdf",
        outputFormat: "txt",
        options: { pageNumber: 1 },
      }),
      request({
        operation: "pdf.inspect",
        inputFormat: "pdf",
        outputFormat: "png",
        options: { pageNumber: 0 },
      }),
      request({
        operation: "pdf.inspect",
        inputFormat: "pdf",
        outputFormat: "jpg",
        options: { quality: 101 },
      }),
      request({
        operation: "pdf.inspect",
        inputFormat: "pdf",
        outputFormat: "png",
        options: { scale: Number.NaN },
      }),
    ]) {
      expect(() => parseRequest(hostile)).toThrow("LOCAL_PROTOCOL_INVALID");
    }
  });

  it("normalizes errors thrown by hostile options without preserving private data", () => {
    const privateBytes = new Uint8Array([65, 66, 67]);
    const forged = Object.assign(new Error("LOCAL_FILE_TOO_LARGE"), {
      cause: privateBytes,
      name: "private.docx bytes",
    });
    const options = new Proxy(
      { encoding: "utf-8" },
      {
        getPrototypeOf() {
          throw forged;
        },
      },
    );

    let caught: unknown;
    try {
      parseRequest(request({ options }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBe(forged);
    expect(caught).toMatchObject({ message: "LOCAL_PROTOCOL_INVALID", name: "Error" });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(caught)).not.toContain("private.docx");
  });

  it("rejects hostile typed arrays and copies valid views", () => {
    class Bytes extends Uint8Array {}
    const proxy = new Proxy(new Uint8Array([1]), {});
    for (const bytes of [new Uint8ClampedArray([1]), new Bytes([1]), proxy]) {
      expect(() => parseRequest(request({ bytes }))).toThrow("LOCAL_PROTOCOL_INVALID");
    }
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(() =>
        parseRequest(request({ bytes: new Uint8Array(new SharedArrayBuffer(1)) })),
      ).toThrow("LOCAL_PROTOCOL_INVALID");
    }
  });

  it("does not dispatch through Array or String prototype methods after inspection", () => {
    const iteratorDescriptor = Reflect.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    const includesDescriptor = Reflect.getOwnPropertyDescriptor(String.prototype, "includes");
    const input = request();
    const hostileRequest = new Proxy(input, {
      getPrototypeOf(target) {
        Object.defineProperty(Array.prototype, Symbol.iterator, {
          configurable: true,
          value: function* empty() {},
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = parseRequest(hostileRequest);
    } finally {
      if (iteratorDescriptor) {
        Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
      }
    }
    expect(parsed?.id).toBe(input.id);

    const parseResponse = api.parseLocalConversionResponse as (value: unknown) => unknown;
    const hostileResponse = new Proxy(success(input.id, { mediaType: "private" }), {
      getPrototypeOf(target) {
        Object.defineProperty(String.prototype, "includes", {
          configurable: true,
          value: (needle: string) => needle === "/",
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });
    let accepted = false;
    try {
      parseResponse(hostileResponse);
      accepted = true;
    } catch {
      accepted = false;
    } finally {
      if (includesDescriptor)
        Object.defineProperty(String.prototype, "includes", includesDescriptor);
    }
    expect(accepted).toBe(false);
  });

  it("does not dispatch through a replaced Uint8Array constructor", () => {
    const constructorDescriptor = Reflect.getOwnPropertyDescriptor(globalThis, "Uint8Array");
    const input = request();
    const callerBytes = input.bytes;
    const hostileRequest = new Proxy(input, {
      getPrototypeOf(target) {
        Object.defineProperty(globalThis, "Uint8Array", {
          configurable: true,
          value: function ReplacedUint8Array() {
            return callerBytes;
          },
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = parseRequest(hostileRequest);
    } finally {
      if (constructorDescriptor) {
        Object.defineProperty(globalThis, "Uint8Array", constructorDescriptor);
      }
    }

    expect(parsed?.bytes).not.toBe(callerBytes);
    expect((parsed?.bytes as Uint8Array).buffer).not.toBe(callerBytes.buffer);
  });

  it("does not dispatch aggregate indexing through a replaced String constructor", () => {
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "String");
    const input = aggregateRequest();
    const hostile = new Proxy(input, {
      getPrototypeOf(target) {
        Object.defineProperty(globalThis, "String", {
          configurable: true,
          value: () => "private.pdf",
          writable: true,
        });
        return Reflect.getPrototypeOf(target);
      },
    });
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = parseRequest(hostile);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "String", descriptor);
    }
    expect(parsed?.id).toBe(input.id);
    expect(parsed?.files).toHaveLength(2);
  });

  it("snapshots an explicit aggregate PDF request with frozen null-prototype children", () => {
    const input = aggregateRequest();
    const parsed = parseRequest(input);
    const files = parsed.files as readonly Record<string, unknown>[];
    const options = parsed.options as Record<string, unknown>;
    const pagePlan = options.pagePlan as readonly Record<string, unknown>[];

    expect(parsed).toMatchObject({
      kind: "aggregate",
      operation: "pdf.organize",
      outputFormat: "pdf",
    });
    expect(files).toHaveLength(2);
    expect(files[0]?.bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(files[0]?.bytes).not.toBe(input.files[0]?.bytes);
    expect(pagePlan).toEqual([
      { source: 1, page: 0, rotation: 90 },
      { source: 0, page: 0, rotation: 0 },
    ]);
    for (const value of [parsed, files, files[0], files[1], options, pagePlan, ...pagePlan]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    for (const value of [parsed, files[0], files[1], options, ...pagePlan]) {
      expect(Object.getPrototypeOf(value as object)).toBeNull();
    }
  });

  it("admits mixed aggregate images while preserving the single-file 25 MiB boundary", () => {
    const parsed = parseRequest(
      aggregateRequest({
        operation: "images.to.pdf",
        files: [
          { inputFormat: "png", bytes: new Uint8Array([137, 80, 78, 71]) },
          { inputFormat: "jpg", bytes: new Uint8Array([255, 216, 255]) },
        ],
        options: {},
      }),
    );
    expect(parsed).toMatchObject({ kind: "aggregate", operation: "images.to.pdf" });
    expect(() =>
      parseRequest(
        request({
          operation: "images.to.pdf",
          inputFormat: "png",
          outputFormat: "pdf",
          bytes: new Uint8Array(40 * MiB),
          options: {},
        }),
      ),
    ).toThrow("LOCAL_FILE_TOO_LARGE");
  });

  it("enforces aggregate per-file, total, file-count and page-plan budgets before copying", () => {
    const twentyOnePdfs = Array.from({ length: 21 }, () => ({
      inputFormat: "pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    }));
    const twoHundredOnePages = Array.from({ length: 201 }, () => ({
      source: 0,
      page: 0,
      rotation: 0,
    }));
    for (const hostile of [
      aggregateRequest({
        files: [{ inputFormat: "pdf", bytes: new Uint8Array(25 * MiB + 1) }],
        options: { pagePlan: [{ source: 0, page: 0, rotation: 0 }] },
      }),
      aggregateRequest({
        files: [
          { inputFormat: "pdf", bytes: new Uint8Array(25 * MiB) },
          { inputFormat: "pdf", bytes: new Uint8Array(25 * MiB) },
          { inputFormat: "pdf", bytes: new Uint8Array([1]) },
        ],
        options: { pagePlan: [{ source: 0, page: 0, rotation: 0 }] },
      }),
      aggregateRequest({ files: twentyOnePdfs }),
      aggregateRequest({ options: { pagePlan: twoHundredOnePages } }),
    ]) {
      expect(() => parseRequest(hostile)).toThrow("LOCAL_FILE_TOO_LARGE");
    }
  });

  it("rejects confused and hostile aggregate envelopes without invoking accessors", () => {
    let calls = 0;
    const accessorFile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorFile, "inputFormat", {
      enumerable: true,
      get() {
        calls += 1;
        return "pdf";
      },
    });
    Object.defineProperty(accessorFile, "bytes", {
      enumerable: true,
      value: new Uint8Array([1]),
    });
    for (const hostile of [
      aggregateRequest({ bytes: new Uint8Array([1]) }),
      aggregateRequest({ sourceFilename: "private.pdf" }),
      aggregateRequest({ files: [accessorFile] }),
      aggregateRequest({ files: [{ inputFormat: "png", bytes: new Uint8Array([1]) }] }),
      aggregateRequest({ options: { pagePlan: [{ source: 2, page: 0, rotation: 0 }] } }),
      aggregateRequest({ options: { pagePlan: [{ source: 0, page: 0, rotation: 45 }] } }),
      aggregateRequest({ files: new Proxy([], {}) }),
    ]) {
      expect(() => parseRequest(hostile)).toThrow("LOCAL_PROTOCOL_INVALID");
    }
    expect(calls).toBe(0);
  });
});

describe("local conversion client lifecycle", () => {
  it("rejects oversize input before creating or posting to a worker", () => {
    const createWorker = vi.fn(() => new FakeWorker().asWorker());
    const LocalConversionClient = api.LocalConversionClient as new (
      factory: () => Worker,
    ) => { run(input: unknown, signal: AbortSignal): Promise<unknown> };
    const instance = new LocalConversionClient(createWorker);
    expect(() =>
      instance.run(
        request({
          operation: "docx.extract",
          inputFormat: "docx",
          outputFormat: "txt",
          bytes: new Uint8Array(25 * MiB + 1),
          options: {},
        }),
        new AbortController().signal,
      ),
    ).toThrow("LOCAL_FILE_TOO_LARGE");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("posts one tight structured clone with transfer ownership and preserves caller bytes", async () => {
    const worker = new FakeWorker();
    const input = request();
    const originalBytes = input.bytes.slice();
    const pending = client(worker).run(input, new AbortController().signal);
    expect(worker.posts).toHaveLength(1);
    expect(worker.posts[0]?.exactTransfer).toBe(true);
    expect(worker.posts[0]?.transferredBuffer?.byteLength).toBe(0);
    expect((worker.posts[0]?.message as { bytes: Uint8Array }).bytes).toEqual(originalBytes);
    expect(input.bytes).toEqual(originalBytes);

    worker.emitMessage(success(input.id));
    await expect(pending).resolves.toMatchObject({ ok: true, mediaType: "text/markdown" });
    expectCleaned(worker);
  });

  it("transfers every aggregate snapshot buffer while preserving every caller buffer", async () => {
    const worker = new FakeWorker();
    const input = aggregateRequest();
    const originals = input.files.map((file) => file.bytes.slice());
    const pending = client(worker).run(input, new AbortController().signal);
    const transfer = worker.postMessage.mock.calls[0]?.[1] as Transferable[];
    const posted = worker.posts[0]?.message as {
      readonly files: readonly { readonly bytes: Uint8Array }[];
    };
    expect(transfer).toHaveLength(2);
    expect(transfer.every((item) => item instanceof ArrayBuffer && item.byteLength === 0)).toBe(
      true,
    );
    expect(posted.files.map((file) => file.bytes)).toEqual(originals);
    expect(input.files.map((file) => file.bytes)).toEqual(originals);

    worker.emitMessage({
      id: input.id,
      ok: true,
      bytes: new Uint8Array([37, 80, 68, 70]),
      mediaType: "application/pdf",
    });
    await expect(pending).resolves.toMatchObject({ ok: true, mediaType: "application/pdf" });
    expectCleaned(worker);
  });

  it("handles abort-before-post and in-flight abort with identical finite cleanup", async () => {
    const beforeWorker = new FakeWorker();
    const beforeController = new AbortController();
    beforeController.abort();
    await expect(client(beforeWorker).run(request(), beforeController.signal)).rejects.toThrow(
      "LOCAL_CONVERSION_CANCELLED",
    );
    expect(beforeWorker.postMessage).not.toHaveBeenCalled();
    expectCleaned(beforeWorker);

    const activeWorker = new FakeWorker();
    const activeController = new AbortController();
    const pending = client(activeWorker).run(request(), activeController.signal);
    activeController.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    expectCleaned(activeWorker);
  });

  it("times out and removes every listener", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = client(worker, 25).run(request(), new AbortController().signal);
      const rejection = expect(pending).rejects.toThrow("LOCAL_CONVERSION_TIMEOUT");
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expectCleaned(worker);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["error", "LOCAL_WORKER_ERROR"],
    ["messageerror", "LOCAL_PROTOCOL_ERROR"],
  ] as const)("maps %s events to fixed errors without exposing event data", async (type, code) => {
    const worker = new FakeWorker();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = client(worker).run(request(), new AbortController().signal);
    worker.emit(type, { message: "private.docx bytes" } as unknown as Event);
    await expect(pending).rejects.toThrow(code);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    expectCleaned(worker);
  });

  it("fails immediately on response id mismatch", async () => {
    const worker = new FakeWorker();
    const pending = client(worker).run(request(), new AbortController().signal);
    worker.emitMessage(success(crypto.randomUUID()));
    await expect(pending).rejects.toThrow("LOCAL_RESPONSE_ID_MISMATCH");
    expectCleaned(worker);
  });

  it("settles once across double and late responses", async () => {
    const worker = new FakeWorker();
    const input = request();
    const pending = client(worker).run(input, new AbortController().signal);
    const saved = worker.firstListener("message");
    worker.emitMessage(success(input.id));
    worker.emitMessage({ id: input.id, ok: false, code: "LOCAL_CONVERSION_FAILED" });
    await expect(pending).resolves.toMatchObject({ ok: true });
    expectCleaned(worker);
    if (saved) invoke(saved, { data: success(input.id) } as MessageEvent);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("ignores a late response after cancellation", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const input = request();
    const pending = client(worker).run(input, controller.signal);
    const saved = worker.firstListener("message");
    controller.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    if (saved) invoke(saved, { data: success(input.id) } as MessageEvent);
    expectCleaned(worker);
  });

  it("rejects worker failures, malformed responses and output-media mismatches", async () => {
    for (const response of [
      { id: request().id, ok: false, code: "LOCAL_CONVERSION_FAILED", private: true },
      { id: request().id, ok: true, bytes: new Uint8Array([1]), mediaType: "image/png" },
      { id: request().id, ok: true, bytes: new Uint8ClampedArray([1]), mediaType: "text/markdown" },
    ]) {
      const worker = new FakeWorker();
      const input = request();
      const pending = client(worker).run(input, new AbortController().signal);
      worker.emitMessage({ ...response, id: input.id });
      await expect(pending).rejects.toThrow("LOCAL_PROTOCOL_ERROR");
      expectCleaned(worker);
    }

    const failedWorker = new FakeWorker();
    const failedInput = request();
    const pending = client(failedWorker).run(failedInput, new AbortController().signal);
    failedWorker.emitMessage({
      id: failedInput.id,
      ok: false,
      code: "LOCAL_CONVERSION_FAILED",
    });
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_FAILED");
    expectCleaned(failedWorker);
  });

  it("cleans up when structured cloning or transfer posting throws", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException("private bytes", "DataCloneError");
    });
    await expect(client(worker).run(request(), new AbortController().signal)).rejects.toThrow(
      "LOCAL_PROTOCOL_ERROR",
    );
    expectCleaned(worker);
  });

  it("normalizes listener registration failures and cleans partial setup", async () => {
    const worker = new FakeWorker();
    const privateError = Object.assign(new Error("private.docx bytes"), {
      cause: new Uint8Array([65, 66, 67]),
    });
    let registrations = 0;
    worker.addEventListener.mockImplementation((type, listener) => {
      registrations += 1;
      if (registrations === 2) throw privateError;
      const listeners = worker.listeners.get(type) ?? new Set<Listener>();
      listeners.add(listener);
      worker.listeners.set(type, listeners);
    });

    let caught: unknown;
    try {
      await client(worker).run(request(), new AbortController().signal);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBe(privateError);
    expect(caught).toMatchObject({ message: "LOCAL_WORKER_ERROR", name: "Error" });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expectCleaned(worker);
  });

  it("stops setup when a hostile listener registration settles synchronously", async () => {
    const worker = new FakeWorker();
    const input = request();
    worker.addEventListener.mockImplementation((type, listener) => {
      const listeners = worker.listeners.get(type) ?? new Set<Listener>();
      listeners.add(listener);
      worker.listeners.set(type, listeners);
      if (type === "message") invoke(listener, { data: success(input.id) } as MessageEvent);
    });

    await expect(client(worker).run(input, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
    });
    expect(worker.addEventListener).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expectCleaned(worker);
  });

  it("uses an intrinsic byte buffer for transfer after prototype poisoning", async () => {
    const bufferDescriptor = Reflect.getOwnPropertyDescriptor(Uint8Array.prototype, "buffer");
    const worker = new FakeWorker();
    const input = request();
    const callerBuffer = input.bytes.buffer;
    const hostileRequest = new Proxy(input, {
      getPrototypeOf(target) {
        Object.defineProperty(Uint8Array.prototype, "buffer", {
          configurable: true,
          get: () => callerBuffer,
        });
        return Reflect.getPrototypeOf(target);
      },
    });

    let pending: Promise<Record<string, unknown>> | undefined;
    try {
      pending = client(worker).run(hostileRequest, new AbortController().signal);
    } finally {
      if (bufferDescriptor) {
        Object.defineProperty(Uint8Array.prototype, "buffer", bufferDescriptor);
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "buffer");
      }
    }

    expect(callerBuffer.byteLength).toBe(3);
    expect(worker.posts[0]?.transferredBuffer).not.toBe(callerBuffer);
    worker.emitMessage(success(input.id));
    await expect(pending).resolves.toMatchObject({ ok: true });
    expectCleaned(worker);
  });
});

describe("local worker endpoint", () => {
  it("validates requests and transfers one successful response", async () => {
    const install = api.installLocalConversionWorker as (
      scope: FakeWorkerScope,
      dispatch: (input: unknown) => Promise<{ bytes: Uint8Array; mediaType: string }>,
    ) => () => void;
    const scope = new FakeWorkerScope();
    const dispatch = vi.fn(async () => ({
      bytes: new Uint8Array([79, 75]),
      mediaType: "text/markdown",
    }));
    const dispose = install(scope, dispatch);
    const input = request();
    scope.emit(input);
    await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(scope.posts[0]?.exactTransfer).toBe(true);
    expect(scope.posts[0]?.message).toMatchObject({ id: input.id, ok: true });
    dispose();
    expect(scope.listeners.size).toBe(0);
  });

  it("emits fixed protocol/conversion codes and never logs input details", async () => {
    const install = api.installLocalConversionWorker as (
      scope: FakeWorkerScope,
      dispatch: (input: unknown) => Promise<{ bytes: Uint8Array; mediaType: string }>,
    ) => () => void;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const invalidScope = new FakeWorkerScope();
    install(invalidScope, vi.fn());
    const invalid = request({ sourceFilename: "private.docx" });
    invalidScope.emit(invalid);
    await vi.waitFor(() => expect(invalidScope.posts).toHaveLength(1));
    expect(invalidScope.posts[0]?.message).toEqual({
      id: invalid.id,
      ok: false,
      code: "LOCAL_PROTOCOL_ERROR",
    });

    const failedScope = new FakeWorkerScope();
    install(failedScope, async () => {
      throw new Error("private.docx bytes");
    });
    const failed = request();
    failedScope.emit(failed);
    await vi.waitFor(() => expect(failedScope.posts).toHaveLength(1));
    expect(failedScope.posts[0]?.message).toEqual({
      id: failed.id,
      ok: false,
      code: "LOCAL_CONVERSION_FAILED",
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("uses an intrinsic response buffer for transfer after dispatcher poisoning", async () => {
    const install = api.installLocalConversionWorker as (
      scope: FakeWorkerScope,
      dispatch: (input: unknown) => Promise<{ bytes: Uint8Array; mediaType: string }>,
    ) => () => void;
    const bufferDescriptor = Reflect.getOwnPropertyDescriptor(Uint8Array.prototype, "buffer");
    const privateBuffer = new Uint8Array([80]).buffer;
    const scope = new FakeWorkerScope();
    install(scope, async () => {
      Object.defineProperty(Uint8Array.prototype, "buffer", {
        configurable: true,
        get: () => privateBuffer,
      });
      return { bytes: new Uint8Array([79, 75]), mediaType: "text/markdown" };
    });

    try {
      scope.emit(request());
      await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
    } finally {
      if (bufferDescriptor) {
        Object.defineProperty(Uint8Array.prototype, "buffer", bufferDescriptor);
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "buffer");
      }
    }

    expect(privateBuffer.byteLength).toBe(1);
    expect(scope.posts[0]?.transferredBuffer).not.toBe(privateBuffer);
  });
});
