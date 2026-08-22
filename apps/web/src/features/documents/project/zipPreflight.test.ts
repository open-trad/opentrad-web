import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_ZIP_BYTES,
  preflightProjectZip,
  type ZipPreflightReport,
} from "./zipPreflight";

const encoder = new TextEncoder();

interface RawEntry {
  path: string;
  data?: Uint8Array;
  flags?: number;
  localFlags?: number;
  method?: number;
  localMethod?: number;
  declaredSize?: number;
  localDeclaredSize?: number;
  crc?: number;
  localCrc?: number;
  localPath?: string;
  extra?: Uint8Array;
  comment?: Uint8Array;
  madeBy?: number;
  internalAttributes?: number;
  externalAttributes?: number;
  diskStart?: number;
  time?: number;
  date?: number;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function rawZip(
  entries: readonly RawEntry[],
  options: {
    diskNumber?: number;
    centralDisk?: number;
    eocdComment?: Uint8Array;
    count?: number;
    prefix?: Uint8Array;
  } = {},
): Uint8Array {
  const localParts: Uint8Array[] = options.prefix ? [options.prefix] : [];
  const centralParts: Uint8Array[] = [];
  let localOffset = options.prefix?.length ?? 0;
  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array();
    const path = encoder.encode(entry.path);
    const localPath = encoder.encode(entry.localPath ?? entry.path);
    const declaredSize = entry.declaredSize ?? data.length;
    const localDeclaredSize = entry.localDeclaredSize ?? declaredSize;
    const local = new Uint8Array(30 + localPath.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, entry.localFlags ?? entry.flags ?? 0, true);
    localView.setUint16(8, entry.localMethod ?? entry.method ?? 0, true);
    localView.setUint16(10, entry.time ?? 0, true);
    localView.setUint16(12, entry.date ?? 0, true);
    localView.setUint32(14, entry.localCrc ?? entry.crc ?? 0, true);
    localView.setUint32(18, localDeclaredSize, true);
    localView.setUint32(22, localDeclaredSize, true);
    localView.setUint16(26, localPath.length, true);
    local.set(localPath, 30);
    localParts.push(local, data);

    const extra = entry.extra ?? new Uint8Array();
    const comment = entry.comment ?? new Uint8Array();
    const central = new Uint8Array(46 + path.length + extra.length + comment.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, entry.madeBy ?? 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, entry.flags ?? 0, true);
    centralView.setUint16(10, entry.method ?? 0, true);
    centralView.setUint16(12, entry.time ?? 0, true);
    centralView.setUint16(14, entry.date ?? 0, true);
    centralView.setUint32(16, entry.crc ?? 0, true);
    centralView.setUint32(20, declaredSize, true);
    centralView.setUint32(24, declaredSize, true);
    centralView.setUint16(28, path.length, true);
    centralView.setUint16(30, extra.length, true);
    centralView.setUint16(32, comment.length, true);
    centralView.setUint16(34, entry.diskStart ?? 0, true);
    centralView.setUint16(36, entry.internalAttributes ?? 0, true);
    centralView.setUint32(38, entry.externalAttributes ?? 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(path, 46);
    central.set(extra, 46 + path.length);
    central.set(comment, 46 + path.length + extra.length);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const localBytes = concat(localParts);
  const centralBytes = concat(centralParts);
  const eocdComment = options.eocdComment ?? new Uint8Array();
  const eocd = new Uint8Array(22 + eocdComment.length);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, options.diskNumber ?? 0, true);
  view.setUint16(6, options.centralDisk ?? 0, true);
  view.setUint16(8, options.count ?? entries.length, true);
  view.setUint16(10, options.count ?? entries.length, true);
  view.setUint32(12, centralBytes.length, true);
  view.setUint32(16, localBytes.length, true);
  view.setUint16(20, eocdComment.length, true);
  eocd.set(eocdComment, 22);
  return concat([localBytes, centralBytes, eocd]);
}

function baseEntries(): [RawEntry, RawEntry] {
  return [
    { path: "manifest.json", data: encoder.encode("{}") },
    { path: "draft.json", data: encoder.encode("{}") },
  ];
}

function expectUnsafe(bytes: Uint8Array, message?: string): void {
  expect(() => preflightProjectZip(bytes)).toThrow(message);
}

describe("bounded STORE-only ZIP preflight", () => {
  it("accepts the exact two-entry floor and reports central/local ranges without inflating", () => {
    const report: ZipPreflightReport = preflightProjectZip(rawZip(baseEntries()));
    expect(report.entries.map((entry) => entry.path)).toEqual(["manifest.json", "draft.json"]);
    expect(report.entries.every((entry) => entry.method === 0 && entry.extraLength === 0)).toBe(
      true,
    );
  });

  it("enforces 2..102 entries and the 52 MiB archive read ceiling", () => {
    expectUnsafe(rawZip([baseEntries()[0] as RawEntry]), "项目包条目数量无效");
    const hundredAttachments = Array.from({ length: 100 }, (_, index) => ({
      path: `attachments/a-${String(index).padStart(3, "0")}.pdf`,
      data: encoder.encode("%PDF-"),
    }));
    expect(
      preflightProjectZip(rawZip([...baseEntries(), ...hundredAttachments])).entries,
    ).toHaveLength(102);
    expectUnsafe(
      rawZip([...baseEntries(), ...hundredAttachments, { path: "attachments/a-100.pdf" }]),
      "项目包条目数量无效",
    );
    expectUnsafe(new Uint8Array(MAX_PROJECT_ZIP_BYTES + 1), "项目包超过 52 MiB");
  });

  it.each([
    ["Zip64", () => rawZip(baseEntries(), { count: 0xffff }), "不支持 Zip64"],
    ["multi-disk", () => rawZip(baseEntries(), { diskNumber: 1 }), "不支持多磁盘"],
    ["encrypted", () => rawZip([{ ...baseEntries()[0], flags: 1 }, baseEntries()[1]]), "不得加密"],
    [
      "deflate",
      () => rawZip([{ ...baseEntries()[0], method: 8 }, baseEntries()[1]]),
      "仅支持 STORE",
    ],
    [
      "extra",
      () => rawZip([{ ...baseEntries()[0], extra: new Uint8Array([1]) }, baseEntries()[1]]),
      "额外字段",
    ],
    [
      "comment",
      () => rawZip([{ ...baseEntries()[0], comment: new Uint8Array([1]) }, baseEntries()[1]]),
      "注释",
    ],
    ["EOCD comment", () => rawZip(baseEntries(), { eocdComment: new Uint8Array([1]) }), "注释"],
    ["mtime", () => rawZip([{ ...baseEntries()[0], time: 1 }, baseEntries()[1]]), "元数据"],
    ["OS", () => rawZip([{ ...baseEntries()[0], madeBy: 0x0314 }, baseEntries()[1]]), "元数据"],
    [
      "attributes",
      () => rawZip([{ ...baseEntries()[0], externalAttributes: 1 }, baseEntries()[1]]),
      "元数据",
    ],
    [
      "symlink",
      () =>
        rawZip([
          { ...baseEntries()[0], madeBy: 0x0314, externalAttributes: 0xa0000000 },
          baseEntries()[1],
        ]),
      "链接或设备",
    ],
    [
      "device",
      () =>
        rawZip([
          { ...baseEntries()[0], madeBy: 0x0314, externalAttributes: 0x20000000 },
          baseEntries()[1],
        ]),
      "链接或设备",
    ],
    ["directory", () => rawZip([{ path: "attachments/" }, baseEntries()[1]]), "目录"],
  ] as const)("rejects %s archives", (_label, build, message) => {
    expectUnsafe(build(), message);
  });

  it.each([
    ["../escape.pdf", "项目包路径不安全"],
    ["/absolute.pdf", "项目包路径不安全"],
    ["C:/drive.pdf", "项目包路径不安全"],
    ["attachments\\evil.pdf", "项目包路径不安全"],
    ["attachments/evil\0.pdf", "项目包路径不安全"],
    ["attachments/__proto__.pdf", "项目包路径不安全"],
  ])("rejects unsafe path %s", (path, message) => {
    expectUnsafe(rawZip([...baseEntries(), { path }]), message);
  });

  it("rejects duplicate and Unicode-normalized path collisions", () => {
    expectUnsafe(
      rawZip([...baseEntries(), { path: "attachments/a.pdf" }, { path: "attachments/a.pdf" }]),
      "项目包路径重复",
    );
    expectUnsafe(
      rawZip([
        ...baseEntries(),
        { path: "attachments/e\u0301.pdf" },
        { path: "attachments/é.pdf" },
      ]),
      "项目包路径归一化冲突",
    );
  });

  it.each([
    ["name", { localPath: "other.json" }, "本地头与中央目录不一致"],
    ["flags", { localFlags: 1 }, "本地头与中央目录不一致"],
    ["method", { localMethod: 8 }, "本地头与中央目录不一致"],
    ["CRC", { crc: 1, localCrc: 2 }, "本地头与中央目录不一致"],
    ["size", { declaredSize: 2, localDeclaredSize: 1 }, "本地头与中央目录不一致"],
  ] as const)("rejects local/central %s mismatch", (_label, patch, message) => {
    expectUnsafe(rawZip([{ ...baseEntries()[0], ...patch }, baseEntries()[1]]), message);
  });

  it("rejects prefix junk and declared single/aggregate overflows before inflation", () => {
    expectUnsafe(rawZip(baseEntries(), { prefix: new Uint8Array([0]) }), "项目包结构不连续");
    expectUnsafe(
      rawZip([...baseEntries(), { path: "attachments/a.pdf", declaredSize: 25 * 1024 * 1024 + 1 }]),
      "单个附件超过 25 MiB",
    );
    expectUnsafe(
      rawZip([
        ...baseEntries(),
        { path: "attachments/a.pdf", declaredSize: 25 * 1024 * 1024 },
        { path: "attachments/b.pdf", declaredSize: 25 * 1024 * 1024 },
        { path: "attachments/c.pdf", declaredSize: 1 },
      ]),
      "项目包附件超过 50 MiB",
    );
  });
});
