import type { LocalOperation } from "./protocol.js";

const MiB = 1024 * 1024;
const IntrinsicError = Error;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;

const limits = Object.create(null) as Record<LocalOperation, number>;
limits["text.semantic"] = 10 * MiB;
limits["document.generate"] = 10 * MiB;
limits["docx.extract"] = 25 * MiB;
limits["pdf.inspect"] = 25 * MiB;
limits["pdf.organize"] = 25 * MiB;
limits["image.convert"] = 25 * MiB;
limits["images.to.pdf"] = 25 * MiB;

export const LOCAL_FILE_LIMITS: Readonly<Record<LocalOperation, number>> = Object.freeze(limits);

export function assertLocalFileLimit(operation: LocalOperation, bytes: number): void {
  const maximum = LOCAL_FILE_LIMITS[operation];
  if (
    maximum === undefined ||
    !intrinsicNumberIsSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > maximum
  ) {
    throw new IntrinsicError("LOCAL_FILE_TOO_LARGE");
  }
}
