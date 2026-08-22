import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertSpreadsheetToCsv } from "../dist/index.js";

function fixture(format) {
  const path = fileURLToPath(new URL(`fixtures/spreadsheet.${format}.base64`, import.meta.url));
  return new Uint8Array(Buffer.from(readFileSync(path, "utf8").trim(), "base64"));
}

for (const format of ["xls", "xlsx", "ods"]) {
  const input = fixture(format);
  const original = new Uint8Array(input);
  const output = await convertSpreadsheetToCsv(
    {
      input,
      inputFormat: format,
      outputFormat: "csv",
      options: { sheetIndex: 1 },
    },
    new AbortController().signal,
  );
  if (
    Buffer.compare(Buffer.from(input), Buffer.from(original)) !== 0 ||
    new TextDecoder().decode(output.subarray(3)) !==
      '中文,"逗号,""引号""","第一行\n第二行",3,1,2\r\n'
  ) {
    throw new Error("native spreadsheet smoke failed");
  }
}
