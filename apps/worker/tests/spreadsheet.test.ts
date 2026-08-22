import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  __spreadsheetTest,
  convertSpreadsheetToCsv,
  SPREADSHEET_POLICY,
} from "../src/adapters/spreadsheet.js";

interface ZipEntryInput {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly method?: 0 | 8;
  readonly flags?: number;
  readonly uncompressedSize?: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function zip(entries: readonly ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0;
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(entry.bytes)) : entry.bytes;
    const size = entry.uncompressedSize ?? entry.bytes.byteLength;
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x0403_4b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, compressed.byteLength, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.byteLength, true);
    localHeader.set(name, 30);
    local.push(localHeader, compressed);

    const centralHeader = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x0201_4b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, compressed.byteLength, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    central.push(centralHeader);
    localOffset += localHeader.byteLength + compressed.byteLength;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x0605_4b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true);
  endView.setUint32(16, localOffset, true);
  return concat([...local, centralBytes, end]);
}

const text = (value: string) => new TextEncoder().encode(value);

function fixture(format: "xls" | "xlsx" | "ods"): Uint8Array {
  const path = fileURLToPath(new URL(`fixtures/spreadsheet.${format}.base64`, import.meta.url));
  return new Uint8Array(Buffer.from(readFileSync(path, "utf8").trim(), "base64"));
}

function safeXlsx(
  extra: readonly ZipEntryInput[] = [],
  workbookContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
): Uint8Array {
  return zip([
    {
      name: "[Content_Types].xml",
      bytes: text(
        `<Types><Override PartName="/xl/workbook.xml" ContentType="${workbookContentType}"/></Types>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      bytes: text(
        '<workbook><sheets><sheet name="首页" sheetId="1"/><sheet name="第二页" sheetId="2"/><sheet name="第三页" sheetId="3"/></sheets></workbook>',
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: text(
        '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
      ),
    },
    {
      name: "xl/worksheets/sheet2.xml",
      bytes: text(
        '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
      ),
    },
    {
      name: "xl/worksheets/sheet3.xml",
      bytes: text(
        '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
      ),
    },
    ...extra,
  ]);
}

function safeOds(extra: readonly ZipEntryInput[] = []): Uint8Array {
  return zip([
    {
      name: "mimetype",
      bytes: text("application/vnd.oasis.opendocument.spreadsheet"),
    },
    {
      name: "content.xml",
      bytes: text(
        '<office:document-content><table:table table:name="S1"><table:table-row><table:table-cell office:value-type="string"><text:p>x</text:p></table:table-cell></table:table-row></table:table></office:document-content>',
      ),
    },
    ...extra,
  ]);
}

function libraryFor(
  sheetNames: unknown,
  selectedWorkbook: unknown,
  calls: Array<{ readonly input: unknown; readonly options: unknown }> = [],
  fullWorkbook: unknown = selectedWorkbook,
) {
  let count = 0;
  return {
    calls,
    read(input: unknown, options: unknown): unknown {
      calls.push({ input, options });
      count += 1;
      if (count === 1) return { SheetNames: sheetNames };
      return count === 2 ? selectedWorkbook : fullWorkbook;
    },
  };
}

function selectedSheet(data: unknown, reference = "A1:E2"): unknown {
  return {
    SheetNames: ["首页", "第二页", "第三页"],
    Sheets: {
      第二页: {
        "!data": data,
        "!ref": reference,
      },
    },
  };
}

function fullSheet(data: unknown, reference = "A1:E2", selectedName = "第二页"): unknown {
  const placeholder = () => ({ "!data": [[{ t: "s", v: "hidden" }]], "!ref": "A1:A1" });
  return {
    SheetNames: ["首页", "第二页", "第三页"],
    Sheets: {
      首页: selectedName === "首页" ? { "!data": data, "!ref": reference } : placeholder(),
      第二页: selectedName === "第二页" ? { "!data": data, "!ref": reference } : placeholder(),
      第三页: selectedName === "第三页" ? { "!data": data, "!ref": reference } : placeholder(),
    },
  };
}

describe("spreadsheet.to.csv built-in adapter", () => {
  it("publishes immutable fail-closed budgets and deterministic CSV policy", () => {
    expect(SPREADSHEET_POLICY).toEqual({
      operation: "spreadsheet.to.csv",
      inputFormats: ["xls", "xlsx", "ods"],
      outputFormat: "csv",
      maxInputBytes: 25 * 1024 * 1024,
      maxSheets: 256,
      maxRows: 100_000,
      maxColumns: 256,
      maxCells: 1_000_000,
      maxOutputBytes: 25 * 1024 * 1024,
      workbook: {
        maxTotalRows: 100_000,
        maxTotalColumns: 65_536,
        maxTotalCells: 1_000_000,
        maxStrings: 1_000_000,
        maxRecords: 2_000_000,
      },
      zip: {
        maxEntries: 2_048,
        maxUncompressedBytes: 64 * 1024 * 1024,
        maxCompressionRatio: 100,
      },
      csv: {
        encoding: "utf-8",
        bom: true,
        delimiter: ",",
        lineEnding: "\r\n",
        finalLineEnding: true,
      },
      thread: {
        timeoutMs: 30_000,
        network: "none",
      },
    });
    expect(Object.isFrozen(SPREADSHEET_POLICY)).toBe(true);
    expect(Object.isFrozen(SPREADSHEET_POLICY.zip)).toBe(true);
    expect(Object.isFrozen(SPREADSHEET_POLICY.csv)).toBe(true);
    expect(Object.isFrozen(SPREADSHEET_POLICY.thread)).toBe(true);
  });

  it("rejects before starting a thread when the request is not an exact spreadsheet conversion", async () => {
    const signal = new AbortController().signal;
    const invalid = {
      input: new Uint8Array([1, 2, 3]),
      inputFormat: "csv",
      outputFormat: "csv",
      options: {},
    };

    await expect(convertSpreadsheetToCsv(invalid, signal)).rejects.toThrow("CONVERSION_FAILED");
  });

  it("accepts only format-consistent XLSX and ODS ZIP containers", () => {
    const xlsxEvidence = __spreadsheetTest.preflight(safeXlsx(), "xlsx");
    expect(xlsxEvidence).toEqual({
      format: "xlsx",
      sheetCount: 3,
      sheetNames: ["首页", "第二页", "第三页"],
    });
    expect(Object.getPrototypeOf(xlsxEvidence)).toBeNull();
    expect(Object.isFrozen(xlsxEvidence)).toBe(true);
    expect(Object.isFrozen(xlsxEvidence.sheetNames)).toBe(true);

    const odsEvidence = __spreadsheetTest.preflight(safeOds(), "ods");
    expect(odsEvidence).toEqual({ format: "ods", sheetCount: 1, sheetNames: ["S1"] });
    expect(Object.getPrototypeOf(odsEvidence)).toBeNull();
    expect(Object.isFrozen(odsEvidence)).toBe(true);
    expect(Object.isFrozen(odsEvidence.sheetNames)).toBe(true);
    expect(() => __spreadsheetTest.preflight(safeXlsx(), "ods")).toThrow("CONVERSION_FAILED");
    expect(() => __spreadsheetTest.preflight(safeOds(), "xlsx")).toThrow("CONVERSION_FAILED");
    expect(() => __spreadsheetTest.preflight(new Uint8Array([0x50, 0x4b]), "xlsx")).toThrow(
      "CONVERSION_FAILED",
    );
  });

  it("rejects ambiguous or unsafe ZIP metadata before SheetJS", () => {
    const threats: Uint8Array[] = [
      safeXlsx([{ name: "../escape", bytes: text("x") }]),
      safeXlsx([{ name: "xl/workbook.xml", bytes: text("duplicate") }]),
      safeXlsx([{ name: "safe", bytes: text("x"), flags: 1 }]),
      safeXlsx([{ name: "safe", bytes: text("x"), flags: 1 << 3 }]),
      safeXlsx([
        {
          name: "bomb",
          bytes: new Uint8Array(1024),
          method: 8,
          uncompressedSize: 1024 * 1024,
        },
      ]),
    ];
    for (const threat of threats) {
      expect(() => __spreadsheetTest.preflight(threat, "xlsx")).toThrow("CONVERSION_FAILED");
    }
  });

  it("rejects active content and external references in spreadsheet packages", () => {
    const threats: readonly (readonly [Uint8Array, "xlsx" | "ods"])[] = [
      [safeXlsx([{ name: "xl/vbaProject.bin", bytes: text("macro") }]), "xlsx"],
      [safeXlsx([{ name: "xl/embeddings/oleObject1.bin", bytes: text("ole") }]), "xlsx"],
      [safeXlsx([{ name: "xl/activeX/activeX1.bin", bytes: text("active") }]), "xlsx"],
      [safeXlsx([{ name: "xl/externalLinks/externalLink1.xml", bytes: text("external") }]), "xlsx"],
      [safeXlsx([{ name: "xl/connections.xml", bytes: text("connection") }]), "xlsx"],
      [
        safeXlsx([
          {
            name: "xl/_rels/workbook.xml.rels",
            bytes: text(
              '<Relationships><Relationship Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
            ),
          },
        ]),
        "xlsx",
      ],
      [
        safeXlsx([
          {
            name: "xl/_rels/workbook.xml.rels",
            bytes: text('<Relationship TargetMode="External" Target="https://evil.invalid/a"/>'),
          },
        ]),
        "xlsx",
      ],
      [safeOds([{ name: "Scripts/python/a.py", bytes: text("active") }]), "ods"],
      [
        safeOds([
          {
            name: "settings.xml",
            bytes: text('<draw:a xlink:href="https://evil.invalid/a"/>'),
          },
        ]),
        "ods",
      ],
    ];
    for (const [threat, format] of threats) {
      expect(() => __spreadsheetTest.preflight(threat, format)).toThrow("CONVERSION_FAILED");
    }
    expect(() =>
      __spreadsheetTest.preflight(
        safeXlsx([], "application/vnd.ms-excel.sheet.binary.macroEnabled.main"),
        "xlsx",
      ),
    ).toThrow("CONVERSION_FAILED");
  });

  it("accepts ordinary XLSX emitted by the pinned SheetJS library, with or without merges", () => {
    for (const merged of [false, true]) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ["macroEnabled", "vbaProject", "oleObject", "activeX", "externalConnection"],
        ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
      ]);
      if (merged) worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
      const input = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
      expect(__spreadsheetTest.preflight(input, "xlsx")).toMatchObject({
        format: "xlsx",
        sheetCount: 1,
        sheetNames: ["Data"],
      });
      expect(() =>
        __spreadsheetTest.convertSync(input, "xlsx", 0, {
          read(bytes: unknown, options: unknown): unknown {
            return XLSX.read(bytes as Uint8Array, options as XLSX.ParsingOptions);
          },
        }),
      ).not.toThrow();
    }
  });

  it("requires the ODS mimetype to be the first STORED local entry", () => {
    const wrongOrder = zip([
      { name: "content.xml", bytes: text("<office:document-content/>") },
      {
        name: "mimetype",
        bytes: text("application/vnd.oasis.opendocument.spreadsheet"),
      },
    ]);
    const compressedMimetype = zip([
      {
        name: "mimetype",
        bytes: text("application/vnd.oasis.opendocument.spreadsheet"),
        method: 8,
      },
      { name: "content.xml", bytes: text("<office:document-content/>") },
    ]);

    expect(() => __spreadsheetTest.preflight(wrongOrder, "ods")).toThrow("CONVERSION_FAILED");
    expect(() => __spreadsheetTest.preflight(compressedMimetype, "ods")).toThrow(
      "CONVERSION_FAILED",
    );
  });

  it("accepts only a structurally valid legacy XLS CFB container", () => {
    const onlyMagic = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => __spreadsheetTest.preflight(onlyMagic, "xls")).toThrow("CONVERSION_FAILED");
    expect(() => __spreadsheetTest.preflight(safeXlsx(), "xls")).toThrow("CONVERSION_FAILED");
  });

  it("bounds every XLSX worksheet before SheetJS receives any bytes", () => {
    const workbook = (sheetCount: number) =>
      `<workbook><sheets>${Array.from(
        { length: sheetCount },
        (_, index) => `<sheet name="S${index + 1}" sheetId="${index + 1}"/>`,
      ).join("")}</sheets></workbook>`;
    const packageWith = (sheetCount: number, worksheets: readonly string[]) =>
      zip([
        {
          name: "[Content_Types].xml",
          bytes: text(
            '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
          ),
        },
        { name: "xl/workbook.xml", bytes: text(workbook(sheetCount)) },
        ...worksheets.map((xml, index) => ({
          name: `xl/worksheets/sheet${index + 1}.xml`,
          bytes: text(xml),
        })),
      ]);
    const worksheet = (reference: string) =>
      `<worksheet><dimension ref="${reference}"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`;

    const threats = [
      packageWith(257, [worksheet("A1")]),
      packageWith(1, [worksheet("A1:IW1")]),
      packageWith(1, [worksheet("A1:K100000")]),
      packageWith(2, [worksheet("A1:A60000"), worksheet("A1:A60000")]),
    ];
    for (const threat of threats) {
      expect(() => __spreadsheetTest.preflight(threat, "xlsx")).toThrow("CONVERSION_FAILED");
    }
  });

  it("expands ODS repetition counts and bounds every table before SheetJS", () => {
    const ods = (body: string) =>
      zip([
        {
          name: "mimetype",
          bytes: text("application/vnd.oasis.opendocument.spreadsheet"),
        },
        {
          name: "content.xml",
          bytes: text(`<office:document-content>${body}</office:document-content>`),
        },
      ]);
    const table = (rows: string) => `<table:table table:name="S">${rows}</table:table>`;
    const row = (attributes: string, cellAttributes = "") =>
      `<table:table-row ${attributes}><table:table-cell ${cellAttributes}/></table:table-row>`;

    const threats = [
      ods(table(row('table:number-rows-repeated="100001"'))),
      ods(table(row("", 'table:number-columns-repeated="257"'))),
      ods(table(row('table:number-rows-repeated="100000"', 'table:number-columns-repeated="11"'))),
      ods(
        Array.from({ length: 257 }, (_, index) => `<table:table table:name="S${index}"/>`).join(""),
      ),
    ];
    for (const threat of threats) {
      expect(() => __spreadsheetTest.preflight(threat, "ods")).toThrow("CONVERSION_FAILED");
    }
  });

  it("bounds legacy BIFF worksheet dimensions and records before SheetJS", () => {
    const cfb = XLSX.CFB.read(fixture("xls"), { type: "array" });
    const workbook = cfb.FileIndex.find(
      (entry: { readonly name?: string }) => entry.name === "Workbook",
    );
    if (!workbook?.content) throw new Error("fixture workbook stream");
    const content = new Uint8Array(workbook.content);
    let mutated = false;
    for (let offset = 0; offset + 14 <= content.byteLength; ) {
      const first = content[offset];
      if (first === undefined) throw new Error("fixture record");
      const id = first | ((content[offset + 1] ?? 0) << 8);
      const length = (content[offset + 2] ?? 0) | ((content[offset + 3] ?? 0) << 8);
      if (id === 0x0200 && length >= 14) {
        new DataView(content.buffer, content.byteOffset).setUint32(offset + 8, 100_001, true);
        mutated = true;
        break;
      }
      offset += 4 + length;
    }
    if (!mutated) throw new Error("fixture dimensions record");
    workbook.content = content;
    workbook.size = content.byteLength;
    const hostile = new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }));
    expect(() => __spreadsheetTest.preflight(hostile, "xls")).toThrow("CONVERSION_FAILED");
  });

  it("parses metadata first, selects exactly one sheet, and emits deterministic UTF-8 BOM CSV", () => {
    const input = safeXlsx();
    const calls: Array<{ readonly input: unknown; readonly options: unknown }> = [];
    const selectedData = [
      [
        { t: "s", v: "中文" },
        { t: "s", v: '逗号,"引号"' },
        { t: "s", v: "第一行\n第二行" },
        { t: "b", v: true },
        { t: "n", v: 3, f: "1+2", w: "3", z: "0" },
      ],
      [{ t: "n", v: 12.5, w: "12.50", z: "0.00" }],
    ];
    const library = libraryFor(
      ["首页", "第二页", "第三页"],
      selectedSheet(selectedData),
      calls,
      fullSheet(selectedData),
    );

    const output = __spreadsheetTest.convertSync(input, "xlsx", 1, library);

    expect([...output.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(output.subarray(3))).toBe(
      '中文,"逗号,""引号""","第一行\n第二行",TRUE,3\r\n12.50,,,,\r\n',
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]?.input).not.toBe(input);
    expect(calls[1]?.input).not.toBe(input);
    expect(calls[0]?.input).not.toBe(calls[1]?.input);
    expect(calls[0]?.options).toEqual({
      type: "array",
      bookSheets: true,
      bookProps: false,
      bookVBA: false,
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellText: false,
      dense: true,
      WTF: true,
    });
    expect(calls[1]?.options).toEqual({
      type: "array",
      bookDeps: false,
      bookFiles: false,
      bookVBA: false,
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      cellStyles: false,
      cellText: true,
      dense: true,
      sheetRows: 100_001,
      sheets: ["第二页"],
      WTF: true,
    });
    expect(calls[2]?.options).toEqual({
      type: "array",
      bookDeps: false,
      bookFiles: false,
      bookVBA: false,
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      cellStyles: false,
      cellText: true,
      dense: true,
      sheetRows: 100_001,
      WTF: true,
    });
  });

  it("escapes dangerous string cells without changing numeric, boolean or cached-value semantics", () => {
    const data = [
      [
        { t: "s", v: "=1+1" },
        { t: "s", v: "  +cmd" },
        { t: "s", v: "\u200b@hidden" },
        { t: "s", v: "＝fullwidth" },
        { t: "s", v: "\tleading-tab" },
        { t: "s", v: "\rleading-cr" },
        { t: "s", v: "\nleading-lf" },
        { t: "s", v: "SeP=;" },
        { t: "s", v: '=quoted,"value"' },
        { t: "n", v: -1, w: "-1" },
        { t: "b", v: false },
        { t: "str", f: '="cached"', v: "=cached", w: "=cached" },
        { t: "s", v: "benign" },
      ],
    ];
    const output = __spreadsheetTest.convertSync(
      safeXlsx(),
      "xlsx",
      1,
      libraryFor(
        ["首页", "第二页", "第三页"],
        selectedSheet(data, "A1:M1"),
        [],
        fullSheet(data, "A1:M1"),
      ),
    );
    expect(new TextDecoder().decode(output.subarray(3))).toBe(
      "'=1+1,'  +cmd,'\u200b@hidden,'＝fullwidth,'\tleading-tab,\"'\rleading-cr\",\"'\nleading-lf\",'SeP=;,\"'=quoted,\"\"value\"\"\",-1,FALSE,'=cached,benign\r\n",
    );
  });

  it("defaults to sheet zero and rejects indices beyond actual metadata, including 255", () => {
    const input = safeXlsx();
    const first = {
      SheetNames: ["首页", "第二页", "第三页"],
      Sheets: { 首页: { "!data": [[{ t: "s", v: "首页" }]], "!ref": "A1:A1" } },
    };
    expect(
      new TextDecoder().decode(
        __spreadsheetTest
          .convertSync(
            input,
            "xlsx",
            undefined,
            libraryFor(
              ["首页", "第二页", "第三页"],
              first,
              [],
              fullSheet([[{ t: "s", v: "首页" }]], "A1:A1", "首页"),
            ),
          )
          .subarray(3),
      ),
    ).toBe("首页\r\n");
    for (const index of [3, 255]) {
      expect(() =>
        __spreadsheetTest.convertSync(
          input,
          "xlsx",
          index,
          libraryFor(["首页", "第二页", "第三页"], first),
        ),
      ).toThrow("CONVERSION_FAILED");
    }
  });

  it("rejects sheet, range, cell, and output budget overruns without truncation", () => {
    const input = safeXlsx();
    const tooManySheets = Array.from({ length: 257 }, (_, index) => `S${index}`);
    expect(() =>
      __spreadsheetTest.convertSync(input, "xlsx", 0, libraryFor(tooManySheets, {})),
    ).toThrow("CONVERSION_FAILED");

    const references = ["A1:A100001", "A1:IW1", "A1:K100000"];
    const data = [[{ t: "s", v: "x" }]];
    for (const reference of references) {
      expect(() =>
        __spreadsheetTest.convertSync(
          input,
          "xlsx",
          1,
          libraryFor(["首页", "第二页", "第三页"], selectedSheet(data, reference)),
        ),
      ).toThrow("CONVERSION_FAILED");
    }
    const tooWide = selectedSheet(data, "A1:A1") as {
      Sheets: Record<string, Record<string, unknown>>;
    };
    const selected = tooWide.Sheets.第二页;
    if (!selected) throw new Error("test fixture");
    selected["!fullref"] = "A1:A100001";
    expect(() =>
      __spreadsheetTest.convertSync(
        input,
        "xlsx",
        1,
        libraryFor(["首页", "第二页", "第三页"], tooWide),
      ),
    ).toThrow("CONVERSION_FAILED");

    const oversized = "中".repeat(9 * 1024 * 1024);
    expect(() =>
      __spreadsheetTest.convertSync(
        input,
        "xlsx",
        1,
        libraryFor(
          ["首页", "第二页", "第三页"],
          selectedSheet([[{ t: "s", v: oversized }]], "A1:A1"),
        ),
      ),
    ).toThrow("CONVERSION_FAILED");
  });

  it("rejects oversized fields before any large UTF-8 encode or escaping allocation", () => {
    const input = safeXlsx();
    const originalEncode = TextEncoder.prototype.encode;
    const originalReplaceAll = String.prototype.replaceAll;
    let largeEncodeCalls = 0;
    let largeReplaceCalls = 0;
    TextEncoder.prototype.encode = function patchedEncode(value = ""): Uint8Array {
      if (value.length > 1_000_000) largeEncodeCalls += 1;
      return Reflect.apply(originalEncode, this, [value]);
    };
    String.prototype.replaceAll = function patchedReplaceAll(
      this: string,
      searchValue: string | RegExp,
      replaceValue: string | ((substring: string, ...args: unknown[]) => string),
    ): string {
      if (this.length > 1_000_000) largeReplaceCalls += 1;
      return Reflect.apply(originalReplaceAll, this, [searchValue, replaceValue]);
    } as typeof String.prototype.replaceAll;
    try {
      const oversizedPlain = "x".repeat(26_214_403);
      expect(() =>
        __spreadsheetTest.convertSync(
          input,
          "xlsx",
          1,
          libraryFor(
            ["首页", "第二页", "第三页"],
            selectedSheet([[{ t: "s", v: oversizedPlain }]], "A1:A1"),
          ),
        ),
      ).toThrow("CONVERSION_FAILED");

      const oversizedEscaped = '"'.repeat(13_107_199);
      expect(() =>
        __spreadsheetTest.convertSync(
          input,
          "xlsx",
          1,
          libraryFor(
            ["首页", "第二页", "第三页"],
            selectedSheet([[{ t: "s", v: oversizedEscaped }]], "A1:A1"),
          ),
        ),
      ).toThrow("CONVERSION_FAILED");
      expect(largeEncodeCalls).toBe(0);
      expect(largeReplaceCalls).toBe(0);
    } finally {
      TextEncoder.prototype.encode = originalEncode;
      String.prototype.replaceAll = originalReplaceAll;
    }
  });

  it("binds SheetJS metadata exactly to immutable preflight sheet evidence", () => {
    const input = safeXlsx();
    const ghostMetadata = ["幽灵", "第二页", "第三页"];
    expect(() =>
      __spreadsheetTest.convertSync(
        input,
        "xlsx",
        1,
        libraryFor(ghostMetadata, {
          SheetNames: ghostMetadata,
          Sheets: {
            第二页: { "!data": [[{ t: "s", v: "ghost" }]], "!ref": "A1:A1" },
          },
        }),
      ),
    ).toThrow("CONVERSION_FAILED");
  });

  it("fails closed on hostile library records, accessors, proxies, cycles, and external formulas", () => {
    const input = safeXlsx();
    const accessorMetadata = {};
    Object.defineProperty(accessorMetadata, "SheetNames", { get: () => ["首页"] });
    const cycle: Record<string, unknown> = { t: "s", v: "x" };
    cycle.self = cycle;
    for (const metadata of [new Proxy({ SheetNames: ["首页"] }, {}), accessorMetadata]) {
      let calls = 0;
      const library = {
        read(): unknown {
          calls += 1;
          return calls === 1 ? metadata : {};
        },
      };
      expect(() => __spreadsheetTest.convertSync(input, "xlsx", 0, library)).toThrow(
        "CONVERSION_FAILED",
      );
    }

    const hostileSelected: readonly unknown[] = [
      selectedSheet([[new Proxy({ t: "s", v: "x" }, {})]], "A1:A1"),
      selectedSheet([[cycle]], "A1:A1"),
      selectedSheet([[{ t: "n", v: 1, w: "1", f: "'[evil.xlsx]S1'!A1" }]], "A1:A1"),
      selectedSheet([[{ t: "s", v: "x", l: { Target: "https://evil.invalid" } }]], "A1:A1"),
      selectedSheet([[{ t: "n", f: "1+2", w: "3" }]], "A1:A1"),
      selectedSheet([[{ t: "n", f: "1+2", v: "3", w: "3" }]], "A1:A1"),
    ];
    for (const workbook of hostileSelected) {
      expect(() =>
        __spreadsheetTest.convertSync(
          input,
          "xlsx",
          1,
          libraryFor(["首页", "第二页", "第三页"], workbook),
        ),
      ).toThrow("CONVERSION_FAILED");
    }
  });

  it("revalidates full-workbook totals but emits only the exact selected sheet", () => {
    const input = safeXlsx();
    const workbook = {
      SheetNames: ["首页", "第二页", "第三页"],
      Sheets: {
        首页: { "!data": [[{ t: "s", v: "不得输出" }]], "!ref": "A1:A1" },
        第三页: { "!data": [[{ t: "s", v: "也不得输出" }]], "!ref": "A1:A1" },
        第二页: { "!data": [[{ t: "s", v: "只输出我" }]], "!ref": "A1:A1" },
      },
    };
    // The adapter accepts all-sheet results for XLS/ODS even when SheetJS ignores `sheets`.
    workbook.Sheets = {
      首页: workbook.Sheets.首页,
      第二页: workbook.Sheets.第二页,
      第三页: workbook.Sheets.第三页,
    };
    const output = __spreadsheetTest.convertSync(
      input,
      "xlsx",
      1,
      libraryFor(["首页", "第二页", "第三页"], workbook),
    );
    expect(new TextDecoder().decode(output.subarray(3))).toBe("只输出我\r\n");

    const oversizedWorkbook = {
      SheetNames: ["首页", "第二页", "第三页"],
      Sheets: {
        首页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A60000" },
        第二页: { "!data": [[{ t: "s", v: "y" }]], "!ref": "A1:A1" },
        第三页: { "!data": [[{ t: "s", v: "z" }]], "!ref": "A1:A60000" },
      },
    };
    expect(() =>
      __spreadsheetTest.convertSync(
        input,
        "xlsx",
        1,
        libraryFor(["首页", "第二页", "第三页"], oversizedWorkbook),
      ),
    ).toThrow("CONVERSION_FAILED");
  });

  it("falls back from a real selected-only parse to one evidence-bound full-workbook parse", () => {
    const calls: Array<{ readonly input: unknown; readonly options: unknown }> = [];
    const library = {
      read(input: unknown, options: unknown): unknown {
        calls.push({ input, options });
        return Reflect.apply(XLSX.read, XLSX, [input, options]);
      },
    };

    const output = __spreadsheetTest.convertSync(fixture("xlsx"), "xlsx", 1, library);
    expect(new TextDecoder().decode(output.subarray(3))).toBe(
      '中文,"逗号,""引号""","第一行\n第二行",3,1,2\r\n',
    );
    expect(calls).toHaveLength(3);
    expect(calls[1]?.options).toMatchObject({ sheets: ["第二页"] });
    expect(calls[2]?.options).toMatchObject({
      type: "array",
      bookDeps: false,
      bookFiles: false,
      bookVBA: false,
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      cellStyles: false,
      cellText: true,
      dense: true,
      sheetRows: 100_001,
      WTF: true,
    });
    expect(calls[2]?.options).not.toHaveProperty("sheets");
    expect(calls[2]?.input).not.toBe(calls[0]?.input);
    expect(calls[2]?.input).not.toBe(calls[1]?.input);
  });

  it("rejects a post-parse budget threat hidden in a non-selected sheet", () => {
    const calls: unknown[] = [];
    const names = ["首页", "第二页", "第三页"];
    const selectedOnly = selectedSheet([[{ t: "s", v: "selected" }]], "A1:A1");
    const hostileFull = {
      SheetNames: names,
      Sheets: {
        首页: { "!data": [[{ t: "s", v: "hidden" }]], "!ref": "A1:A100001" },
        第二页: { "!data": [[{ t: "s", v: "selected" }]], "!ref": "A1:A1" },
        第三页: { "!data": [[{ t: "s", v: "hidden" }]], "!ref": "A1:A1" },
      },
    };
    let readCount = 0;
    const library = {
      read(input: unknown, options: unknown): unknown {
        calls.push({ input, options });
        readCount += 1;
        if (readCount === 1) return { SheetNames: names };
        return readCount === 2 ? selectedOnly : hostileFull;
      },
    };

    expect(() => __spreadsheetTest.convertSync(safeXlsx(), "xlsx", 1, library)).toThrow(
      "CONVERSION_FAILED",
    );
    expect(calls).toHaveLength(3);
  });

  it.each([
    ["selected-only", () => selectedSheet([[{ t: "s", v: "still partial" }]], "A1:A1")],
    [
      "ghost names",
      () => ({
        SheetNames: ["幽灵", "第二页", "第三页"],
        Sheets: {
          幽灵: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          第二页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          第三页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
        },
      }),
    ],
    [
      "missing sheet",
      () => ({
        SheetNames: ["首页", "第二页", "第三页"],
        Sheets: {
          首页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          第二页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
        },
      }),
    ],
    [
      "extra sheet",
      () => ({
        SheetNames: ["首页", "第二页", "第三页"],
        Sheets: {
          首页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          第二页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          第三页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          多余: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
        },
      }),
    ],
    [
      "accessor",
      () => {
        const workbook = {
          Sheets: {
            首页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
            第二页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
            第三页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
          },
        };
        Object.defineProperty(workbook, "SheetNames", {
          get: () => ["首页", "第二页", "第三页"],
        });
        return workbook;
      },
    ],
    [
      "proxy",
      () =>
        new Proxy(
          {
            SheetNames: ["首页", "第二页", "第三页"],
            Sheets: {
              首页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
              第二页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
              第三页: { "!data": [[{ t: "s", v: "x" }]], "!ref": "A1:A1" },
            },
          },
          {},
        ),
    ],
  ])("rejects a hostile %s full-workbook fallback result", (_label, fullWorkbook) => {
    const names = ["首页", "第二页", "第三页"];
    const selectedOnly = selectedSheet([[{ t: "s", v: "selected" }]], "A1:A1");
    let calls = 0;
    const library = {
      read(): unknown {
        calls += 1;
        if (calls === 1) return { SheetNames: names };
        return calls === 2 ? selectedOnly : fullWorkbook();
      },
    };
    expect(() => __spreadsheetTest.convertSync(safeXlsx(), "xlsx", 1, library)).toThrow(
      "CONVERSION_FAILED",
    );
    expect(calls).toBe(3);
  });

  it.each(["xls", "xlsx", "ods"] as const)(
    "converts an independently generated real three-sheet %s fixture",
    (format) => {
      const errorSpy =
        format === "ods" ? vi.spyOn(console, "error").mockImplementation(() => {}) : undefined;
      try {
        const input = fixture(format);
        expect(() => __spreadsheetTest.preflight(input, format)).not.toThrow();
        const second = __spreadsheetTest.convertSync(input, format, 1, XLSX);
        const defaultSheet = __spreadsheetTest.convertSync(input, format, undefined, XLSX);
        const third = __spreadsheetTest.convertSync(input, format, 2, XLSX);

        expect([...second.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(new TextDecoder().decode(second.subarray(3))).toBe(
          '中文,"逗号,""引号""","第一行\n第二行",3,1,2\r\n',
        );
        expect(new TextDecoder().decode(defaultSheet.subarray(3))).toBe("首页\r\n3\r\n");
        expect(new TextDecoder().decode(third.subarray(3))).toBe("第三页\r\n");
        expect(() => __spreadsheetTest.convertSync(input, format, 3, XLSX)).toThrow(
          "CONVERSION_FAILED",
        );
        expect(() => __spreadsheetTest.convertSync(input, format, 255, XLSX)).toThrow(
          "CONVERSION_FAILED",
        );
      } finally {
        errorSpy?.mockRestore();
      }
    },
  );
});
