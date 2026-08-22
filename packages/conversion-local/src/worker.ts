import {
  type LocalConversionResponse,
  type LocalWorkerRequest,
  mediaTypeMatchesOutput,
  parseLocalConversionRequest,
  parseLocalConversionResponse,
  readLocalMessageId,
} from "./protocol.js";

const IntrinsicError = Error;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(Uint8Array.prototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;

export interface LocalWorkerOutput {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export type LocalWorkerDispatch<TRequest extends LocalWorkerRequest = LocalWorkerRequest> = (
  request: TRequest,
) => LocalWorkerOutput | Promise<LocalWorkerOutput>;

export interface LocalWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

interface LocalWorkerTarget {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

function postFailure(
  target: LocalWorkerTarget,
  id: string,
  code: "LOCAL_CONVERSION_FAILED" | "LOCAL_PROTOCOL_ERROR",
): void {
  try {
    target.postMessage({ id, ok: false, code });
  } catch {
    // A dead worker scope has no observable consumer; never log uploaded data.
  }
}

function transferBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  if (!intrinsicTypedArrayBuffer) throw new IntrinsicError("LOCAL_PROTOCOL_ERROR");
  return intrinsicReflectApply(intrinsicTypedArrayBuffer, bytes, []) as ArrayBuffer;
}

export function installLocalConversionWorker<TRequest extends LocalWorkerRequest>(
  scope: LocalWorkerScope,
  dispatch: LocalWorkerDispatch<TRequest>,
): () => void {
  let claimed = false;
  const onMessage = async (event: MessageEvent<unknown>) => {
    if (claimed) return;
    claimed = true;
    scope.removeEventListener("message", onMessage);
    const target: LocalWorkerTarget =
      event.ports?.length === 1 && event.ports[0] ? event.ports[0] : scope;
    if (!target) return;
    const messageId = readLocalMessageId(event.data);
    let request: LocalWorkerRequest;
    try {
      request = parseLocalConversionRequest(event.data);
    } catch {
      if (messageId) postFailure(target, messageId, "LOCAL_PROTOCOL_ERROR");
      return;
    }

    try {
      const output = await (dispatch as LocalWorkerDispatch)(request);
      const response = parseLocalConversionResponse({
        id: request.id,
        ok: true,
        bytes: output.bytes,
        mediaType: output.mediaType,
      });
      if (!response.ok || !mediaTypeMatchesOutput(request.outputFormat, response.mediaType)) {
        postFailure(target, request.id, "LOCAL_CONVERSION_FAILED");
        return;
      }
      target.postMessage(response, [transferBuffer(response.bytes)]);
    } catch {
      postFailure(target, request.id, "LOCAL_CONVERSION_FAILED");
    }
  };

  scope.addEventListener("message", onMessage);
  return () => scope.removeEventListener("message", onMessage);
}

export type { LocalConversionResponse };
