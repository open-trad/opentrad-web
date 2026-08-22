import { parentPort } from "node:worker_threads";
import * as XLSX from "xlsx";
import { handleSpreadsheetThreadMessage } from "../adapters/spreadsheet.js";

const port = parentPort;
if (!port) throw new Error("CONVERSION_FAILED");

const discard = () => undefined;
for (const method of ["debug", "error", "info", "log", "warn"] as const) {
  try {
    Object.defineProperty(console, method, { configurable: false, value: discard });
  } catch {}
}

port.once("message", (input: unknown) => {
  try {
    const response = handleSpreadsheetThreadMessage(input, XLSX);
    if (response.ok && response.output) port.postMessage(response, [response.output]);
    else port.postMessage(response);
  } catch {
    // A malformed parent message is not echoed. Closing produces a fixed parent-side failure.
  } finally {
    port.close();
  }
});
