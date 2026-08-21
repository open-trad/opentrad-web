import { connect, type Socket } from "node:net";

const COMMAND = Buffer.from("zINSTREAM\0", "ascii");
const TERMINATOR = Buffer.alloc(4);
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024;
const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|[0-9A-Fa-f:]+)$/u;

export type ScannerErrorCode = "MALWARE_DETECTED" | "SCANNER_UNAVAILABLE";

export class ScannerError extends Error {
  readonly code: ScannerErrorCode;

  constructor(code: ScannerErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface ClamdClientOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
}

function unavailable(): ScannerError {
  return new ScannerError("SCANNER_UNAVAILABLE");
}

function abortPromise(signal: AbortSignal | undefined): {
  readonly promise: Promise<never>;
  readonly remove: () => void;
} {
  let listener: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(unavailable());
      return;
    }
    listener = () => reject(unavailable());
    signal?.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    remove: () => {
      if (listener) signal?.removeEventListener("abort", listener);
    },
  };
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  const abort = abortPromise(signal);
  try {
    return await Promise.race([promise, abort.promise]);
  } finally {
    abort.remove();
  }
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", connected);
      socket.off("error", failed);
      socket.off("close", closed);
    };
    const connected = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(unavailable());
    };
    const closed = () => {
      cleanup();
      reject(unavailable());
    };
    socket.once("connect", connected);
    socket.once("error", failed);
    socket.once("close", closed);
  });
}

function writeWithBackpressure(socket: Socket, buffer: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    let callbackDone = false;
    let drainDone = true;
    let settled = false;
    const cleanup = () => {
      socket.off("error", failed);
      socket.off("close", failed);
      socket.off("drain", drained);
    };
    const finish = () => {
      if (settled || !callbackDone || !drainDone) return;
      settled = true;
      cleanup();
      resolve();
    };
    const failed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(unavailable());
    };
    const drained = () => {
      drainDone = true;
      finish();
    };
    socket.once("error", failed);
    socket.once("close", failed);
    const writable = socket.write(buffer, (error?: Error | null) => {
      if (error) {
        failed();
        return;
      }
      callbackDone = true;
      finish();
    });
    if (!writable) {
      drainDone = false;
      socket.once("drain", drained);
    }
  });
}

function collectResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      socket.off("data", data);
      socket.off("end", ended);
      socket.off("close", closed);
      socket.off("error", failed);
    };
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (value === undefined) reject(unavailable());
      else resolve(value);
    };
    const data = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        finish();
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    const complete = () => {
      const combined = Buffer.concat(chunks, size);
      if (combined.length < 2) {
        finish();
        return;
      }
      const terminal = combined[combined.length - 1];
      if (terminal !== 0 && terminal !== 10) {
        finish();
        return;
      }
      const body = combined.subarray(0, -1);
      if (body.includes(0) || body.includes(10)) {
        finish();
        return;
      }
      finish(body.toString("ascii"));
    };
    const ended = () => complete();
    const closed = () => complete();
    const failed = () => finish();
    socket.on("data", data);
    socket.once("end", ended);
    socket.once("close", closed);
    socket.once("error", failed);
  });
}

async function closeIterator(iterator: AsyncIterator<Uint8Array>): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // The public scanner error remains fixed.
  }
}

export class ClamdClient {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;

  constructor(options: ClamdClientOptions) {
    const timeout = options?.timeoutMs ?? 30_000;
    if (
      options === null ||
      typeof options !== "object" ||
      typeof options.host !== "string" ||
      !HOST_PATTERN.test(options.host) ||
      !Number.isSafeInteger(options.port) ||
      options.port < 1 ||
      options.port > 65_535 ||
      !Number.isSafeInteger(timeout) ||
      timeout < 10 ||
      timeout > 120_000
    ) {
      throw unavailable();
    }
    this.#host = options.host;
    this.#port = options.port;
    this.#timeoutMs = timeout;
  }

  async scan(source: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<"clean"> {
    let socket: Socket | undefined;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      if (source === null || typeof source !== "object") throw unavailable();
      iterator = source[Symbol.asyncIterator]();
      if (
        iterator === null ||
        typeof iterator !== "object" ||
        typeof iterator.next !== "function"
      ) {
        throw unavailable();
      }
      socket = connect({ host: this.#host, port: this.#port });
      socket.setNoDelay(true);
      const response = collectResponse(socket);
      void response.catch(() => undefined);
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(unavailable()), this.#timeoutMs);
      });
      const operation = (async () => {
        await withAbort(waitForConnect(socket as Socket), signal);
        await withAbort(writeWithBackpressure(socket as Socket, COMMAND), signal);
        const responseGraceMs = Math.min(20, Math.max(1, this.#timeoutMs - 5));
        const commandResponse = await Promise.race([
          response.then((value) => ({ received: true as const, value })),
          new Promise<{ readonly received: false }>((resolve) => {
            setTimeout(() => resolve({ received: false }), responseGraceMs);
          }),
        ]);
        if (commandResponse.received) {
          if (/^stream: [A-Za-z0-9._-]{1,128} FOUND$/u.test(commandResponse.value)) {
            throw new ScannerError("MALWARE_DETECTED");
          }
          throw unavailable();
        }
        while (true) {
          const nextPromise = withAbort(Promise.resolve(iterator?.next()), signal);
          void nextPromise.catch(() => undefined);
          const event = await Promise.race([
            nextPromise.then((value) => ({ kind: "next" as const, value })),
            response.then((value) => ({ kind: "response" as const, value })),
          ]);
          if (event.kind === "response") {
            if (/^stream: [A-Za-z0-9._-]{1,128} FOUND$/u.test(event.value)) {
              throw new ScannerError("MALWARE_DETECTED");
            }
            throw unavailable();
          }
          const next = event.value;
          if (next.done) break;
          const value = next.value;
          if (!(value instanceof Uint8Array)) throw unavailable();
          let offset = 0;
          while (offset < value.byteLength) {
            const size = Math.min(MAX_FRAME_BYTES, value.byteLength - offset);
            const frame = Buffer.allocUnsafe(4 + size);
            frame.writeUInt32BE(size, 0);
            Buffer.from(value.buffer, value.byteOffset + offset, size).copy(frame, 4);
            await withAbort(writeWithBackpressure(socket as Socket, frame), signal);
            offset += size;
          }
        }
        await withAbort(writeWithBackpressure(socket as Socket, TERMINATOR), signal);
        socket?.end();
        const text = await withAbort(response, signal);
        if (text === "stream: OK") return "clean" as const;
        if (/^stream: [A-Za-z0-9._-]{1,128} FOUND$/u.test(text)) {
          throw new ScannerError("MALWARE_DETECTED");
        }
        throw unavailable();
      })();
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (iterator) await closeIterator(iterator);
      if (error instanceof ScannerError && error.code === "MALWARE_DETECTED") throw error;
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      socket?.destroy();
    }
  }
}
