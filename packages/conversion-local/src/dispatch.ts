import type { LocalWorkerRequest } from "./protocol.js";
import type { LocalWorkerOutput } from "./worker.js";

const IntrinsicError = Error;

export async function dispatchLocalConversion(
  request: LocalWorkerRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  switch (request.operation) {
    case "text.semantic": {
      const { dispatchSemanticTextConversion } = await import("./text/convertText.js");
      return dispatchSemanticTextConversion(request, signal);
    }
    case "document.generate":
      if ("kind" in request) break;
      return (await import("./document/generateDocument.js")).dispatchDocumentGeneration(
        request,
        signal,
      );
    case "docx.extract":
      if ("kind" in request) break;
      return (await import("./docx/convertDocx.js")).dispatchDocxConversion(request, signal);
    case "pdf.inspect":
    case "pdf.organize":
    case "images.to.pdf":
      return (await import("./pdf/transformPdf.js")).dispatchPdfConversion(request, signal);
    case "image.convert":
      if ("kind" in request) break;
      return (await import("./image/convertImage.js")).dispatchImageConversion(request, signal);
  }
  throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
}
