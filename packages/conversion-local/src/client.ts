import {
  type LocalConversionResponse,
  type LocalConversionSuccess,
  type LocalWorkerRequest,
  mediaTypeMatchesOutput,
  parseLocalConversionRequest,
  parseLocalConversionResponse,
} from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const IntrinsicError = Error;
const intrinsicClearTimeout = globalThis.clearTimeout;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicSetTimeout = globalThis.setTimeout;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(Uint8Array.prototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;

function fixedError(code: string): Error {
  return new IntrinsicError(code);
}

function tryCleanup(action: () => void): void {
  try {
    action();
  } catch {
    // Cleanup must continue even if a hostile Worker implementation throws.
  }
}

function transferBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  if (!intrinsicTypedArrayBuffer) throw fixedError("LOCAL_PROTOCOL_ERROR");
  try {
    return intrinsicReflectApply(intrinsicTypedArrayBuffer, bytes, []) as ArrayBuffer;
  } catch {
    throw fixedError("LOCAL_PROTOCOL_ERROR");
  }
}

function transferBuffers(request: LocalWorkerRequest): ArrayBuffer[] {
  if ("kind" in request) {
    const buffers: ArrayBuffer[] = [];
    for (let index = 0; index < request.files.length; index += 1) {
      const file = request.files[index];
      if (!file) throw fixedError("LOCAL_PROTOCOL_ERROR");
      buffers[index] = transferBuffer(file.bytes);
    }
    return buffers;
  }
  return [transferBuffer(request.bytes)];
}

export class LocalConversionClient {
  constructor(
    private readonly createWorker: () => Worker,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw fixedError("LOCAL_TIMEOUT_INVALID");
    }
  }

  run(input: unknown, signal: AbortSignal): Promise<LocalConversionSuccess> {
    const request = parseLocalConversionRequest(input);
    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch {
      throw fixedError("LOCAL_WORKER_ERROR");
    }

    return new Promise<LocalConversionSuccess>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer !== undefined) intrinsicClearTimeout(timer);
        tryCleanup(() => signal.removeEventListener("abort", onAbort));
        tryCleanup(() => worker.removeEventListener("message", onMessage));
        tryCleanup(() => worker.removeEventListener("error", onError));
        tryCleanup(() => worker.removeEventListener("messageerror", onMessageError));
        tryCleanup(() => worker.terminate());
      };

      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(fixedError(code));
      };

      const succeed = (response: LocalConversionSuccess) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };

      const onAbort = () => fail("LOCAL_CONVERSION_CANCELLED");
      const onError = () => fail("LOCAL_WORKER_ERROR");
      const onMessageError = () => fail("LOCAL_PROTOCOL_ERROR");
      const onMessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        let response: LocalConversionResponse;
        try {
          response = parseLocalConversionResponse(event.data);
        } catch {
          fail("LOCAL_PROTOCOL_ERROR");
          return;
        }
        if (response.id !== request.id) {
          fail("LOCAL_RESPONSE_ID_MISMATCH");
          return;
        }
        if (!response.ok) {
          fail(response.code);
          return;
        }
        if (!mediaTypeMatchesOutput(request.outputFormat, response.mediaType)) {
          fail("LOCAL_PROTOCOL_ERROR");
          return;
        }
        succeed(response);
      };

      try {
        worker.addEventListener("message", onMessage);
        if (settled) return;
        worker.addEventListener("error", onError);
        if (settled) return;
        worker.addEventListener("messageerror", onMessageError);
        if (settled) return;
        signal.addEventListener("abort", onAbort, { once: true });
        if (settled) return;
      } catch {
        fail("LOCAL_WORKER_ERROR");
        return;
      }

      if (signal.aborted) {
        fail("LOCAL_CONVERSION_CANCELLED");
        return;
      }

      timer = intrinsicSetTimeout(() => fail("LOCAL_CONVERSION_TIMEOUT"), this.timeoutMs);
      try {
        worker.postMessage(request, transferBuffers(request));
      } catch {
        fail("LOCAL_PROTOCOL_ERROR");
      }
    });
  }
}

export type { LocalWorkerRequest };
