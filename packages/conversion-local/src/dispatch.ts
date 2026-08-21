import { dispatchDocumentGeneration } from "./document/generateDocument.js";
import { dispatchDocxConversion } from "./docx/convertDocx.js";
import { dispatchImageConversion } from "./image/convertImage.js";
import { dispatchPdfConversion } from "./pdf/transformPdf.js";
import type { LocalWorkerRequest } from "./protocol.js";
import { dispatchSemanticTextConversion } from "./text/convertText.js";
import type { LocalWorkerOutput } from "./worker.js";

const IntrinsicError = Error;

export async function dispatchLocalConversion(
  request: LocalWorkerRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  switch (request.operation) {
    case "text.semantic":
      return dispatchSemanticTextConversion(request, signal);
    case "document.generate":
      if ("kind" in request) break;
      return dispatchDocumentGeneration(request, signal);
    case "docx.extract":
      if ("kind" in request) break;
      return dispatchDocxConversion(request, signal);
    case "pdf.inspect":
    case "pdf.organize":
    case "images.to.pdf":
      return dispatchPdfConversion(request, signal);
    case "image.convert":
      if ("kind" in request) break;
      return dispatchImageConversion(request, signal);
  }
  throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
}
