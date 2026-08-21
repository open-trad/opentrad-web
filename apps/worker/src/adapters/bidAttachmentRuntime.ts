import { type BidArchiveRuntime, createBidArchiveRuntime } from "../policies/bidArchive.js";
import { inspectBidAttachmentBytes } from "./bidAttachmentInspector.js";
import {
  type BidImageDecodeRuntime,
  createBidImageDecodeRuntime,
  decodeAttachedBidImage,
} from "./bidImageDecode.js";

const intrinsicDateNow = Date.now;

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function createRuntime(jobId: unknown, decodeRuntime: BidImageDecodeRuntime): BidArchiveRuntime {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) throw new Error("INVALID_REQUEST");
  let sequence = 0;
  const inspectAttachment: BidArchiveRuntime["inspectAttachment"] = (
    bytes,
    mediaType,
    maximumPages,
    absoluteDeadline,
    signal,
  ) => {
    const current = intrinsicDateNow();
    const inspectorDeadline = Math.min(absoluteDeadline, current + 10_000);
    return inspectBidAttachmentBytes(
      bytes,
      mediaType,
      maximumPages,
      signal,
      inspectorDeadline,
    ).then(async (result) => {
      if (mediaType === "image/png" || mediaType === "image/jpeg") {
        await decodeAttachedBidImage(
          bytes,
          mediaType,
          jobId,
          sequence,
          signal,
          absoluteDeadline,
          decodeRuntime,
        );
      }
      sequence += 1;
      return result;
    });
  };
  return createBidArchiveRuntime({
    inspectAttachment,
    now: intrinsicDateNow,
  });
}

/** Test-only decoder seam. Deliberately omitted from the package barrel. */
export function createBidAttachmentArchiveRuntimeForTesting(
  jobId: unknown,
  decodeRuntime: BidImageDecodeRuntime,
): BidArchiveRuntime {
  return createRuntime(jobId, decodeRuntime);
}

export function createBidAttachmentArchiveRuntime(...input: readonly unknown[]): BidArchiveRuntime {
  if (input.length !== 1) throw new Error("INVALID_REQUEST");
  return createRuntime(input[0], createBidImageDecodeRuntime());
}
