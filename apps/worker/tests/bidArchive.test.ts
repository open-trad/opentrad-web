import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProxy } from "node:util/types";
import { describe, expect, it, vi } from "vitest";
import { createBidAttachmentArchiveRuntimeForTesting } from "../src/adapters/bidAttachmentRuntime.js";
import { createBidImageDecodeRuntimeForTesting } from "../src/adapters/bidImageDecode.js";
import {
  BidPolicyError,
  copyCanonicalBidAttachmentBytes,
  copyCanonicalBidDraftBytes,
  createBidArchiveRuntime,
  parseCanonicalBidArchive,
} from "../src/policies/bidArchive.js";
import { compileCanonicalBidProject, createBidCompileRuntime } from "../src/policies/bidCompile.js";
import {
  copyRenderedBidDocumentBytes,
  renderCompiledBidDocument,
} from "../src/policies/bidDocument.js";
import {
  createBidRasterFileRuntimeForTesting,
  createBidRasterRuntime,
  createBidRasterRuntimeForTesting,
  rasterizeBidAttachments,
} from "../src/policies/bidRaster.js";

const MiB = 1024 * 1024;
const request = {
  templateId: "bid.government.goods.v1",
  templateVersion: "1.0.0",
} as const;
const encoder = new TextEncoder();

type MediaType = "application/pdf" | "image/png" | "image/jpeg";
type AttachedInput = {
  readonly bytes: Uint8Array;
  readonly category?: string;
  readonly displayName?: string;
  readonly id: string;
  readonly includedInSubmission: boolean;
  readonly mediaType: MediaType;
  readonly pageCount: number;
  readonly sourceRef?: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly data: Uint8Array;
  readonly path: string;
}

function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + path.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.byteLength, true);
    localView.setUint32(22, entry.data.byteLength, true);
    localView.setUint16(26, path.byteLength, true);
    local.set(path, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + path.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.byteLength, true);
    centralView.setUint32(24, entry.data.byteLength, true);
    centralView.setUint16(28, path.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(path, 46);
    centralParts.push(central);
    localOffset += local.byteLength + entry.data.byteLength;
  }
  const localLength = localParts.reduce((total, part) => total + part.byteLength, 0);
  const centralLength = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(localLength + centralLength + 22);
  let offset = 0;
  for (const part of [...localParts, ...centralParts]) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  const eocd = new DataView(output.buffer, offset, 22);
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralLength, true);
  eocd.setUint32(16, localLength, true);
  return output;
}

function storedEntries(input: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  while (
    new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, true) === 0x04034b50
  ) {
    const view = new DataView(input.buffer, input.byteOffset + offset, 30);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameOffset = offset + 30;
    const dataOffset = nameOffset + nameLength + extraLength;
    entries.push({
      path: decoder.decode(input.subarray(nameOffset, nameOffset + nameLength)),
      data: input.slice(dataOffset, dataOffset + size),
    });
    offset = dataOffset + size;
  }
  return entries;
}

function rewriteJsonEntry(
  input: Uint8Array,
  path: "manifest.json" | "draft.json",
  mutate: (value: Record<string, unknown>) => void,
): Uint8Array {
  return storedZip(
    storedEntries(input).map((entry) => {
      if (entry.path !== path) return entry;
      const value = JSON.parse(new TextDecoder().decode(entry.data)) as Record<string, unknown>;
      mutate(value);
      return { ...entry, data: encoder.encode(stableJson(value)) };
    }),
  );
}

function localDataOffset(input: Uint8Array, targetPath: string): number {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  while (
    new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, true) === 0x04034b50
  ) {
    const view = new DataView(input.buffer, input.byteOffset + offset, 30);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameOffset = offset + 30;
    const dataOffset = nameOffset + nameLength + extraLength;
    if (decoder.decode(input.subarray(nameOffset, nameOffset + nameLength)) === targetPath) {
      return dataOffset;
    }
    offset = dataOffset + size;
  }
  throw new Error("entry not found");
}

function attachmentExtension(mediaType: MediaType): "pdf" | "png" | "jpg" {
  return mediaType === "application/pdf" ? "pdf" : mediaType === "image/png" ? "png" : "jpg";
}

function archive(attached: readonly AttachedInput[] = []): Uint8Array {
  const template = {
    id: request.templateId,
    version: request.templateVersion,
    basisDate: "2026-08-19",
  };
  const presentation = { languageView: "zh-CN", layoutStyleId: "classic-formal.v1" };
  const descriptors = attached.map((item) => ({
    id: item.id,
    category: item.category ?? "technical",
    displayName: item.displayName ?? `${item.id}-private-display-name`,
    mediaType: item.mediaType,
    pageCount: item.pageCount,
    required: true,
    ...(item.sourceRef === undefined ? {} : { sourceRef: item.sourceRef }),
    status: "attached",
    includedInSubmission: item.includedInSubmission,
  }));
  const draft = {
    formatVersion: "2.0.0",
    template,
    draft: {
      id: "bid-archive-test",
      templateId: request.templateId,
      templateVersion: request.templateVersion,
    },
    presentation,
    attachmentManifest: descriptors,
  };
  const draftBytes = encoder.encode(stableJson(draft));
  const files = attached.map((item) => ({
    id: item.id,
    path: `attachments/${item.id}.${attachmentExtension(item.mediaType)}`,
    mediaType: item.mediaType,
    byteLength: item.bytes.byteLength,
    pageCount: item.pageCount,
  }));
  const manifest = {
    formatVersion: "2.0.0",
    template,
    presentation,
    attachmentManifest: descriptors,
    files,
    bidAssembly: {
      ...request,
      body: { byteLength: draftBytes.byteLength, pageCount: 1 },
      attachmentManifest: descriptors.map((descriptor, index) => ({
        ...descriptor,
        byteLength: attached[index]?.bytes.byteLength,
      })),
    },
  };
  return storedZip([
    { path: "manifest.json", data: encoder.encode(stableJson(manifest)) },
    { path: "draft.json", data: draftBytes },
    ...attached
      .map((item) => ({
        path: `attachments/${item.id}.${attachmentExtension(item.mediaType)}`,
        data: item.bytes,
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  ]);
}

function runtime(pageCounts: Readonly<Record<string, number>> = {}) {
  return createBidArchiveRuntime({
    inspectAttachment: vi.fn(async (bytes: Uint8Array, mediaType: MediaType) => ({
      pageCount:
        pageCounts[`${mediaType}:${bytes.byteLength}`] ?? (mediaType === "application/pdf" ? 2 : 1),
    })),
    now: () => 1_000,
  });
}

function pdf(length = 16): Uint8Array {
  const output = new Uint8Array(length);
  output.set(encoder.encode("%PDF-1.7"));
  return output;
}

function png(length = 16): Uint8Array {
  const output = new Uint8Array(length);
  output.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return output;
}

function rasterJpeg(width = 2, height = 4): Uint8Array {
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x01,
    0xff,
    0xd9,
  );
}

function expectFixedFailure(error: unknown): boolean {
  return (
    error instanceof BidPolicyError &&
    error.code === "INVALID_REQUEST" &&
    error.message === "INVALID_REQUEST"
  );
}

describe("canonical bid archive parser", () => {
  it("derives the accepted bid template set from the contracts authority", async () => {
    const source = await readFile(
      new URL("../src/policies/bidArchive.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("BID_TEMPLATE_IDS as CONTRACT_BID_TEMPLATE_IDS");
    expect(source).not.toContain('new Set<BidTemplateId>([\n  "bid.government.goods.v1"');
  });

  it("returns frozen metadata while keeping archive bytes in a private fresh-copy store", async () => {
    const input = archive([
      {
        id: "source-main",
        bytes: pdf(),
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: false,
        sourceRef: "https://example.invalid/private-source.pdf",
      },
    ]);
    const original = input.slice();
    const inspector = runtime();
    const parsed = await parseCanonicalBidArchive(input, request, undefined, inspector);
    input.fill(0);

    expect(parsed.evidence).toMatchObject({
      archiveBytes: original.byteLength,
      attachedBytes: 16,
      attachedCount: 1,
      bodyPageCountHint: 1,
      includedBytes: 0,
      includedCount: 0,
      entryCount: 3,
    });
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(parsed.evidence)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.evidence)).toBe(true);
    expect(Object.isFrozen(parsed.attachments)).toBe(true);
    expect(parsed.attachments[0]).toMatchObject({
      id: "source-main",
      sourceRef: "https://example.invalid/private-source.pdf",
    });
    expect(parsed).not.toHaveProperty("draftBytes");
    expect(parsed.attachments[0]).not.toHaveProperty("bytes");
    const first = copyCanonicalBidAttachmentBytes(parsed, 0, "source-main");
    const second = copyCanonicalBidAttachmentBytes(parsed, 0, "source-main");
    expect(first).toEqual(pdf());
    expect(first).not.toBe(second);
    first.fill(0);
    expect(copyCanonicalBidAttachmentBytes(parsed, 0, "source-main")).toEqual(pdf());
    const firstDraft = copyCanonicalBidDraftBytes(parsed);
    firstDraft.fill(0);
    expect(copyCanonicalBidDraftBytes(parsed)).not.toEqual(firstDraft);
    expect(inspector.inspectAttachment).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(parsed.evidence)).not.toMatch(/private-display-name|private-source/);
  });

  it("fully decodes included and excluded attached images before returning canonical metadata", async () => {
    const files = new Map<string, Uint8Array>();
    const commands: Array<{ readonly argv: readonly string[]; readonly executable: string }> = [];
    const decodeRuntime = createBidImageDecodeRuntimeForTesting({
      now: Date.now,
      remove: async (path: string) => {
        files.delete(path);
      },
      removeTree: async (path: string) => {
        for (const key of files.keys()) if (key.startsWith(`${path}/`)) files.delete(key);
      },
      run: async (spec: { readonly argv: readonly string[]; readonly executable: string }) => {
        commands.push(spec);
        const output = spec.argv[2];
        if (output) files.set(output, Uint8Array.of(1));
      },
      verify: async (path: string) => files.has(path),
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes.slice());
      },
    });
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: rasterJpeg(),
          mediaType: "image/jpeg",
          pageCount: 1,
          includedInSubmission: true,
        },
        {
          id: "excluded-image",
          bytes: rasterJpeg(),
          mediaType: "image/jpeg",
          pageCount: 1,
          includedInSubmission: false,
        },
      ]),
      request,
      undefined,
      createBidAttachmentArchiveRuntimeForTesting(
        "123e4567-e89b-42d3-a456-426614174000",
        decodeRuntime,
      ),
    );
    expect(
      parsed.attachments.map(({ id, includedInSubmission }) => ({ id, includedInSubmission })),
    ).toEqual([
      { id: "included-image", includedInSubmission: true },
      { id: "excluded-image", includedInSubmission: false },
    ]);
    expect(parsed.evidence).toMatchObject({ attachedCount: 2, includedCount: 1 });
    expect(commands.map((command) => command.executable)).toEqual([
      "/usr/bin/vips",
      "/usr/bin/vips",
    ]);
    expect(files.size).toBe(0);
  });

  it("runs a canonical archive through the real compile, raster and render chain", async () => {
    const draft = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/document-core/tests/fixtures/v2/bid-government-goods.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const draftAttachments = draft.attachments as Array<Record<string, unknown>>;
    const attached = draftAttachments.map((descriptor, index) => ({
      bytes: pdf(16 + index),
      category: descriptor.category as string,
      displayName: descriptor.displayName as string,
      id: descriptor.id as string,
      includedInSubmission: descriptor.includedInSubmission as boolean,
      mediaType: "application/pdf" as const,
      pageCount: descriptor.pageCount as number,
      ...(descriptor.sourceRef === undefined ? {} : { sourceRef: descriptor.sourceRef as string }),
    }));
    let input = archive(attached);
    input = storedZip(
      storedEntries(input).map((entry) =>
        entry.path === "draft.json"
          ? {
              ...entry,
              data: encoder.encode(
                stableJson({
                  formatVersion: "2.0.0",
                  template: {
                    id: request.templateId,
                    version: request.templateVersion,
                    basisDate: "2026-08-19",
                  },
                  draft,
                  presentation: { languageView: "zh-CN", layoutStyleId: "classic-formal.v1" },
                  attachmentManifest: draftAttachments,
                }),
              ),
            }
          : entry,
      ),
    );
    const draftSize = storedEntries(input).find((entry) => entry.path === "draft.json")?.data
      .byteLength;
    input = rewriteJsonEntry(input, "manifest.json", (manifest) => {
      const bidAssembly = manifest.bidAssembly as Record<string, unknown>;
      (bidAssembly.body as Record<string, unknown>).byteLength = draftSize;
    });

    const parsed = await parseCanonicalBidArchive(
      input,
      request,
      undefined,
      runtime({
        "application/pdf:16": 62,
        "application/pdf:17": 1,
        "application/pdf:18": 8,
      }),
    );
    const compiled = compileCanonicalBidProject(
      copyCanonicalBidDraftBytes(parsed),
      request,
      createBidCompileRuntime({ now: () => Date.parse("2026-08-20T04:00:00.000Z") }),
    );
    const files = new Map<string, Uint8Array>();
    const raster = await rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      undefined,
      createBidRasterRuntimeForTesting({
        now: Date.now,
        read: async (path: string) => files.get(path) ?? rasterJpeg(),
        remove: async (path: string) => {
          files.delete(path);
        },
        run: async (spec: { readonly argv: readonly string[]; readonly executable: string }) => {
          if (spec.executable.endsWith("pdftoppm")) {
            const stem = spec.argv[spec.argv.length - 1];
            if (stem) files.set(`${stem}.jpg`, rasterJpeg());
          } else if (spec.executable.endsWith("vips")) {
            const output = spec.argv[2]?.replace(/\[.*$/u, "");
            if (output) files.set(output, rasterJpeg());
          }
        },
        write: async (path: string, bytes: Uint8Array) => {
          files.set(path, bytes.slice());
        },
      }),
    );
    const rendered = await renderCompiledBidDocument(compiled, raster);
    expect(Object.getPrototypeOf(compiled)).toBeNull();
    expect(rendered.attachmentPages).toBe(9);
    expect(Array.from(copyRenderedBidDocumentBytes(rendered).subarray(0, 4))).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    expect(files.size).toBe(0);
  }, 20_000);

  it("does not start raster file I/O at the exact absolute deadline", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const write = vi.fn(async () => undefined);
    let first = true;
    await expect(
      rasterizeBidAttachments(
        parsed,
        "123e4567-e89b-42d3-a456-426614174000",
        undefined,
        createBidRasterRuntimeForTesting({
          now: () => {
            if (first) {
              first = false;
              return 0;
            }
            return 300_000;
          },
          read: async () => rasterJpeg(),
          remove: async () => undefined,
          run: async () => undefined,
          write,
        }),
        300_000,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects forged archive snapshots, proxies, unknown ids and wrong order", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "proof",
          bytes: pdf(),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: false,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    for (const forged of [
      Object.freeze(Object.create(null)),
      new Proxy(parsed, {}),
      { ...parsed },
    ]) {
      expect(() => copyCanonicalBidDraftBytes(forged)).toThrow(BidPolicyError);
      expect(() => copyCanonicalBidAttachmentBytes(forged, 0, "proof")).toThrow(BidPolicyError);
    }
    expect(() => copyCanonicalBidAttachmentBytes(parsed, 1, "proof")).toThrow(BidPolicyError);
    expect(() => copyCanonicalBidAttachmentBytes(parsed, 0, "unknown")).toThrow(BidPolicyError);
  });

  it("copies private bytes without calling mutable collection, typed-array or buffer intrinsics", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "proof",
          bytes: pdf(),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: false,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const originalGet = WeakMap.prototype.get;
    const originalSet = Uint8Array.prototype.set;
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const getterTargets = [
      [typedArrayPrototype, Symbol.toStringTag],
      [typedArrayPrototype, "buffer"],
      [typedArrayPrototype, "byteLength"],
      [typedArrayPrototype, "byteOffset"],
      [ArrayBuffer.prototype, "byteLength"],
      ...(Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")
        ? ([[ArrayBuffer.prototype, "resizable"]] as const)
        : []),
    ] as const;
    const originalGetters = getterTargets.map(([target, key]) => [
      target,
      key,
      Reflect.getOwnPropertyDescriptor(target, key),
    ]) as ReadonlyArray<readonly [object, PropertyKey, PropertyDescriptor | undefined]>;
    const leaked: unknown[] = [];
    let draftCopy: Uint8Array | undefined;
    let attachmentCopy: Uint8Array | undefined;
    try {
      WeakMap.prototype.get = () => {
        throw new Error("PRIVATE_WEAKMAP_SENTINEL");
      };
      Uint8Array.prototype.set = () => {
        throw new Error("PRIVATE_TYPED_ARRAY_SENTINEL");
      };
      for (const [target, key, descriptor] of originalGetters) {
        if (!descriptor) continue;
        Object.defineProperty(target, key, {
          ...descriptor,
          get(this: unknown) {
            leaked.push(this);
            throw new Error("PRIVATE_GETTER_SENTINEL");
          },
        });
      }
      draftCopy = copyCanonicalBidDraftBytes(parsed);
      attachmentCopy = copyCanonicalBidAttachmentBytes(parsed, 0, "proof");
    } finally {
      for (const [target, key, descriptor] of originalGetters) {
        if (descriptor) Object.defineProperty(target, key, descriptor);
      }
      WeakMap.prototype.get = originalGet;
      Uint8Array.prototype.set = originalSet;
    }
    expect(leaked).toEqual([]);
    expect(draftCopy?.byteLength).toBeGreaterThan(0);
    expect(attachmentCopy).toEqual(pdf());
  });

  it.each([
    ["Buffer", Buffer.from(archive())],
    ["plain object", { byteLength: archive().byteLength }],
    ["proxy", new Proxy(archive(), {})],
  ])("rejects %s before parsing", async (_label, input) => {
    await expect(parseCanonicalBidArchive(input, request, undefined, runtime())).rejects.toSatisfy(
      expectFixedFailure,
    );
  });

  it("rejects SharedArrayBuffer, detached and resizable backing stores when supported", async () => {
    if (typeof SharedArrayBuffer === "function") {
      await expect(
        parseCanonicalBidArchive(
          new Uint8Array(new SharedArrayBuffer(64)),
          request,
          undefined,
          runtime(),
        ),
      ).rejects.toSatisfy(expectFixedFailure);
    }
    const detached = archive();
    structuredClone(detached.buffer, { transfer: [detached.buffer as ArrayBuffer] });
    await expect(
      parseCanonicalBidArchive(detached, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);

    const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
      new (length: number, options: { maxByteLength: number }): ArrayBuffer;
    };
    try {
      const resizable = new ResizableArrayBuffer(64, { maxByteLength: 128 });
      const descriptor = Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable");
      if (descriptor?.get && Reflect.apply(descriptor.get, resizable, []) === true) {
        await expect(
          parseCanonicalBidArchive(new Uint8Array(resizable), request, undefined, runtime()),
        ).rejects.toSatisfy(expectFixedFailure);
      }
    } catch {
      // The current Node runtime does not expose resizable ArrayBuffers.
    }
  });

  it("rejects accessors and unbranded hostile runtime objects without invoking them", async () => {
    const getter = vi.fn(() => archive());
    const hostileInput = Object.create(Uint8Array.prototype);
    Object.defineProperty(hostileInput, "byteLength", { get: getter });
    await expect(
      parseCanonicalBidArchive(hostileInput, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    expect(getter).not.toHaveBeenCalled();
    await expect(
      parseCanonicalBidArchive(archive(), request, undefined, {
        inspectAttachment: async () => ({ pageCount: 1 }),
        now: () => 0,
      } as never),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it.each([
    [
      "CRC",
      (bytes: Uint8Array) => {
        bytes[43] = (bytes[43] ?? 0) ^ 1;
      },
    ],
    [
      "local version",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(4, 21, true);
      },
    ],
    [
      "local flag",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(6, 1, true);
      },
    ],
    [
      "local method",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(8, 8, true);
      },
    ],
    [
      "local timestamp",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(10, 1, true);
      },
    ],
    [
      "local date",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(12, 1, true);
      },
    ],
    [
      "local CRC",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint32(14, 1, true);
      },
    ],
    [
      "local compressed size",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint32(18, 1, true);
      },
    ],
    [
      "local size",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint32(22, 1, true);
      },
    ],
    [
      "local name length",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(26, 1, true);
      },
    ],
    [
      "local extra",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(28, 1, true);
      },
    ],
    [
      "EOCD comment",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(bytes.byteLength - 2, 1, true);
      },
    ],
    [
      "multi-disk",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint16(bytes.byteLength - 18, 1, true);
      },
    ],
  ])("rejects noncanonical %s metadata", async (_label, mutate) => {
    const bytes = archive();
    mutate(bytes);
    await expect(parseCanonicalBidArchive(bytes, request, undefined, runtime())).rejects.toSatisfy(
      expectFixedFailure,
    );
  });

  it("rejects central header metadata, offsets, gaps and trailing bytes", async () => {
    for (const mutate of [
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 4, 21, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 6, 21, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 8, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 10, 8, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 12, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 14, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint32(central + 20, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 30, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 32, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 34, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint16(central + 36, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint32(central + 38, 1, true),
      (bytes: Uint8Array, central: number) =>
        new DataView(bytes.buffer).setUint32(central + 42, 1, true),
    ]) {
      const bytes = archive();
      const central = new DataView(bytes.buffer).getUint32(bytes.byteLength - 6, true);
      mutate(bytes, central);
      await expect(
        parseCanonicalBidArchive(bytes, request, undefined, runtime()),
      ).rejects.toSatisfy(expectFixedFailure);
    }
    const trailing = new Uint8Array(archive().byteLength + 1);
    trailing.set(archive());
    await expect(
      parseCanonicalBidArchive(trailing, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it.each([
    [
      "wrong order",
      [
        { path: "draft.json", data: encoder.encode("{}") },
        { path: "manifest.json", data: encoder.encode("{}") },
      ],
    ],
    [
      "traversal",
      [
        { path: "manifest.json", data: encoder.encode("{}") },
        { path: "draft.json", data: encoder.encode("{}") },
        { path: "attachments/../secret.pdf", data: pdf() },
      ],
    ],
    [
      "backslash",
      [
        { path: "manifest.json", data: encoder.encode("{}") },
        { path: "draft.json", data: encoder.encode("{}") },
        { path: "attachments\\secret.pdf", data: pdf() },
      ],
    ],
    [
      "NFC duplicate",
      [
        { path: "manifest.json", data: encoder.encode("{}") },
        { path: "draft.json", data: encoder.encode("{}") },
        { path: "attachments/e\u0301.pdf", data: pdf() },
        { path: "attachments/é.pdf", data: pdf() },
      ],
    ],
    [
      "unsorted",
      [
        { path: "manifest.json", data: encoder.encode("{}") },
        { path: "draft.json", data: encoder.encode("{}") },
        { path: "attachments/z.pdf", data: pdf() },
        { path: "attachments/a.pdf", data: pdf() },
      ],
    ],
  ])("rejects %s paths", async (_label, entries) => {
    await expect(
      parseCanonicalBidArchive(storedZip(entries), request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it("enforces archive, JSON, entry, central and attachment +1 limits", async () => {
    await expect(
      parseCanonicalBidArchive(new Uint8Array(52 * MiB + 1), request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    const tooLargeJson = storedZip([
      { path: "manifest.json", data: new Uint8Array(MiB + 1) },
      { path: "draft.json", data: encoder.encode("{}") },
    ]);
    await expect(
      parseCanonicalBidArchive(tooLargeJson, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    const tooManyEntries = storedZip(
      Array.from({ length: 103 }, (_, index) => ({
        path:
          index === 0
            ? "manifest.json"
            : index === 1
              ? "draft.json"
              : `attachments/a${String(index).padStart(3, "0")}.pdf`,
        data: encoder.encode("{}"),
      })),
    );
    await expect(
      parseCanonicalBidArchive(tooManyEntries, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    const oversizedCentral = storedZip([
      { path: "manifest.json", data: encoder.encode("{}") },
      { path: "draft.json", data: encoder.encode("{}") },
      ...Array.from({ length: 100 }, (_, index) => ({
        path: `attachments/${String(index).padStart(3, "0")}${"a".repeat(1300)}.pdf`,
        data: new Uint8Array(),
      })),
    ]);
    await expect(
      parseCanonicalBidArchive(oversizedCentral, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    const overSingle = archive([
      {
        id: "large",
        bytes: pdf(25 * MiB + 1),
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: false,
      },
    ]);
    await expect(
      parseCanonicalBidArchive(overSingle, request, undefined, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
  }, 30_000);

  it("counts all attached excluded files against 50 MiB and never relaxes the budget", async () => {
    const one = pdf(17 * MiB);
    const two = pdf(17 * MiB);
    const three = pdf(16 * MiB + 1);
    const input = archive([
      {
        id: "excluded-a",
        bytes: one,
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: false,
      },
      {
        id: "excluded-b",
        bytes: two,
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: false,
      },
      {
        id: "source-only",
        bytes: three,
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: false,
      },
    ]);
    await expect(parseCanonicalBidArchive(input, request, undefined, runtime())).rejects.toSatisfy(
      expectFixedFailure,
    );
  }, 30_000);

  it("inspects every attached file but reports included bytes separately", async () => {
    const inspectAttachment = vi.fn(
      async (
        _bytes: Uint8Array,
        mediaType: MediaType,
        _maximumPages: number,
        _deadline: number,
        _signal: AbortSignal | undefined,
      ) => ({ pageCount: mediaType === "application/pdf" ? 2 : 1 }),
    );
    const brandedRuntime = createBidArchiveRuntime({ inspectAttachment, now: () => 1_000 });
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "excluded",
          bytes: pdf(),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: false,
          sourceRef: "https://example.invalid/never-fetch",
        },
        {
          id: "included",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      brandedRuntime,
    );
    expect(inspectAttachment).toHaveBeenCalledTimes(2);
    expect(parsed.evidence).toMatchObject({
      attachedBytes: 32,
      attachedCount: 2,
      includedBytes: 16,
      includedCount: 1,
    });
    for (const call of inspectAttachment.mock.calls) {
      expect(call).toHaveLength(5);
      expect(call[0]).toBeInstanceOf(Uint8Array);
      expect(call[3]).toBe(11_000);
      expect(call[4]).toBeUndefined();
    }
    expect(inspectAttachment.mock.calls[0]?.[2]).toBe(10_000);
    expect(inspectAttachment.mock.calls[1]?.[2]).toBe(1);
  });

  it("accepts excluded PDFs up to 10,000 pages but keeps the included total at 80", async () => {
    const excluded110 = await parseCanonicalBidArchive(
      archive([
        {
          id: "excluded-source",
          bytes: pdf(17),
          mediaType: "application/pdf",
          pageCount: 110,
          includedInSubmission: false,
        },
      ]),
      request,
      undefined,
      runtime({ "application/pdf:17": 110 }),
    );
    expect(excluded110).toMatchObject({ evidence: { attachedCount: 1, includedCount: 0 } });

    await expect(
      parseCanonicalBidArchive(
        archive([
          {
            id: "portable-maximum",
            bytes: pdf(19),
            mediaType: "application/pdf",
            pageCount: 10_000,
            includedInSubmission: false,
          },
        ]),
        request,
        undefined,
        runtime({ "application/pdf:19": 10_000 }),
      ),
    ).resolves.toMatchObject({ evidence: { attachedCount: 1, includedCount: 0 } });

    await expect(
      parseCanonicalBidArchive(
        archive([
          {
            id: "portable-over-maximum",
            bytes: pdf(20),
            mediaType: "application/pdf",
            pageCount: 10_001,
            includedInSubmission: false,
          },
        ]),
        request,
        undefined,
        runtime({ "application/pdf:20": 10_001 }),
      ),
    ).rejects.toSatisfy(expectFixedFailure);

    await expect(
      parseCanonicalBidArchive(
        archive([
          {
            id: "included-pages",
            bytes: pdf(18),
            mediaType: "application/pdf",
            pageCount: 80,
            includedInSubmission: true,
          },
        ]),
        request,
        undefined,
        runtime({ "application/pdf:18": 80 }),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it("rejects image page counts other than one and actual page mismatches", async () => {
    await expect(
      parseCanonicalBidArchive(
        archive([
          {
            id: "image",
            bytes: png(),
            mediaType: "image/png",
            pageCount: 2,
            includedInSubmission: true,
          },
        ]),
        request,
        undefined,
        runtime(),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
    await expect(
      parseCanonicalBidArchive(
        archive([
          {
            id: "pdf",
            bytes: pdf(),
            mediaType: "application/pdf",
            pageCount: 3,
            includedInSubmission: true,
          },
        ]),
        request,
        undefined,
        runtime(),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it("maps hostile inspection, timeout, abort and runtime errors to one fixed failure", async () => {
    const input = archive([
      {
        id: "pdf",
        bytes: pdf(),
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: true,
        sourceRef: "private-sentinel",
      },
    ]);
    for (const inspectAttachment of [
      async () => new Proxy({ pageCount: 2 }, {}),
      async () => {
        const value = {} as { pageCount: number };
        Object.defineProperty(value, "pageCount", { enumerable: true, get: () => 2 });
        return value;
      },
      async () => {
        throw new Error("private-sentinel");
      },
    ]) {
      let failure: unknown;
      try {
        await parseCanonicalBidArchive(
          input,
          request,
          undefined,
          createBidArchiveRuntime({ inspectAttachment, now: () => 1_000 }),
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toSatisfy(expectFixedFailure);
      expect(String(failure)).not.toContain("sentinel");
    }
    let now = 1_000;
    await expect(
      parseCanonicalBidArchive(
        input,
        request,
        undefined,
        createBidArchiveRuntime({
          inspectAttachment: async () => {
            now = 11_000;
            return { pageCount: 2 };
          },
          now: () => now,
        }),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseCanonicalBidArchive(input, request, controller.signal, runtime()),
    ).rejects.toSatisfy(expectFixedFailure);
    await expect(
      parseCanonicalBidArchive(input, request, undefined, undefined as never),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it("interrupts a hostile inspector that never settles when the caller aborts", async () => {
    const input = archive([
      {
        id: "hung",
        bytes: pdf(),
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: true,
      },
    ]);
    const controller = new AbortController();
    const pending = parseCanonicalBidArchive(
      input,
      request,
      controller.signal,
      createBidArchiveRuntime({
        inspectAttachment: async () => new Promise(() => undefined),
        now: () => 1_000,
      }),
    );
    setImmediate(() => controller.abort());
    await expect(pending).rejects.toSatisfy(expectFixedFailure);
  }, 1_000);

  it("enforces the single ten-second wall timeout when an inspector never settles", async () => {
    vi.useFakeTimers();
    try {
      const input = archive([
        {
          id: "hung-timeout",
          bytes: pdf(),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: true,
        },
      ]);
      const pending = parseCanonicalBidArchive(
        input,
        request,
        undefined,
        createBidArchiveRuntime({
          inspectAttachment: async () => new Promise(() => undefined),
          now: () => 1_000,
        }),
      );
      const assertion = expect(pending).rejects.toSatisfy(expectFixedFailure);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects accessor/proxy runtime factories without invoking accessors", () => {
    const getter = vi.fn(() => async () => ({ pageCount: 1 }));
    const hostile = { now: () => 0 } as Record<string, unknown>;
    Object.defineProperty(hostile, "inspectAttachment", { enumerable: true, get: getter });
    expect(() => createBidArchiveRuntime(hostile)).toThrow(BidPolicyError);
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      createBidArchiveRuntime(
        new Proxy({ inspectAttachment: async () => ({ pageCount: 1 }), now: () => 0 }, {}),
      ),
    ).toThrow(BidPolicyError);
  });

  it("cross-checks every outer, draft, bidAssembly, file and entry layer", async () => {
    const attached = [
      {
        id: "proof",
        bytes: pdf(),
        mediaType: "application/pdf" as const,
        pageCount: 2,
        includedInSubmission: true,
      },
    ];
    const cases: Uint8Array[] = [];
    cases.push(
      rewriteJsonEntry(archive(attached), "manifest.json", (manifest) => {
        (manifest.template as Record<string, unknown>).id = "bid.enterprise.goods.v1";
      }),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "draft.json", (draft) => {
        (draft.presentation as Record<string, unknown>).languageView = "en-US";
      }),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "draft.json", (draft) => {
        (
          (draft.attachmentManifest as Array<Record<string, unknown>>)[0] as Record<string, unknown>
        ).displayName = "mismatch";
      }),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "manifest.json", (manifest) => {
        (
          (manifest.bidAssembly as Record<string, unknown>).body as Record<string, unknown>
        ).byteLength = 1;
      }),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "manifest.json", (manifest) => {
        (
          (manifest.files as Array<Record<string, unknown>>)[0] as Record<string, unknown>
        ).byteLength = 1;
      }),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "manifest.json", (manifest) => {
        (
          (manifest.files as Array<Record<string, unknown>>)[0] as Record<string, unknown>
        ).pageCount = 1;
      }),
    );
    cases.push(
      storedZip(
        storedEntries(archive(attached)).filter((entry) => !entry.path.startsWith("attachments/")),
      ),
    );
    cases.push(
      rewriteJsonEntry(archive(attached), "manifest.json", (manifest) => {
        Object.defineProperty(manifest, "__proto__", {
          enumerable: true,
          value: { poisoned: true },
        });
      }),
    );
    for (const input of cases) {
      await expect(
        parseCanonicalBidArchive(input, request, undefined, runtime()),
      ).rejects.toSatisfy(expectFixedFailure);
    }
  });

  it("passes only copied bytes to the inspector and never fetches sourceRef", async () => {
    const original = pdf();
    const inspectAttachment = vi.fn(async (inspected: Uint8Array) => {
      inspected.fill(0);
      return { pageCount: 2 };
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "source",
          bytes: original,
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: false,
          sourceRef: "https://example.invalid/never-fetch",
        },
      ]),
      request,
      undefined,
      createBidArchiveRuntime({ inspectAttachment, now: () => 1_000 }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(parsed.attachments[0]?.sourceRef).toBe("https://example.invalid/never-fetch");
    expect(copyCanonicalBidAttachmentBytes(parsed, 0, "source")).toEqual(original);
  });

  it("verifies attachment CRC before invoking the hostile-byte inspector", async () => {
    const input = archive([
      {
        id: "proof",
        bytes: pdf(),
        mediaType: "application/pdf",
        pageCount: 2,
        includedInSubmission: true,
      },
    ]);
    const offset = localDataOffset(input, "attachments/proof.pdf");
    input[offset + 15] = (input[offset + 15] ?? 0) ^ 1;
    const inspectAttachment = vi.fn(async () => ({ pageCount: 2 }));
    await expect(
      parseCanonicalBidArchive(
        input,
        request,
        undefined,
        createBidArchiveRuntime({ inspectAttachment, now: () => 1_000 }),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
    expect(inspectAttachment).not.toHaveBeenCalled();
  });

  it("does not accept old/no bidAssembly or cross-layer mismatches", async () => {
    const valid = archive();
    const centralOffset = new DataView(valid.buffer).getUint32(valid.byteLength - 6, true);
    expect(centralOffset).toBeGreaterThan(0);
    const oldManifest = {
      formatVersion: "2.0.0",
      template: {
        id: request.templateId,
        version: request.templateVersion,
        basisDate: "2026-08-19",
      },
      presentation: { languageView: "zh-CN", layoutStyleId: "classic-formal.v1" },
      attachmentManifest: [],
      files: [],
    };
    const draftBytes = encoder.encode(
      stableJson({
        formatVersion: "2.0.0",
        template: oldManifest.template,
        draft: {
          id: "old",
          templateId: request.templateId,
          templateVersion: request.templateVersion,
        },
        presentation: oldManifest.presentation,
        attachmentManifest: [],
      }),
    );
    await expect(
      parseCanonicalBidArchive(
        storedZip([
          { path: "manifest.json", data: encoder.encode(stableJson(oldManifest)) },
          { path: "draft.json", data: draftBytes },
        ]),
        request,
        undefined,
        runtime(),
      ),
    ).rejects.toSatisfy(expectFixedFailure);
  });

  it("keeps runtime values and output free of proxies", async () => {
    const parsed = await parseCanonicalBidArchive(archive(), request, undefined, runtime());
    expect(isProxy(parsed)).toBe(false);
    expect(isProxy(parsed.evidence)).toBe(false);
  });

  it("rasterizes only included attachments in manifest order through fixed tools", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "excluded-source",
          bytes: pdf(17),
          mediaType: "application/pdf",
          pageCount: 110,
          includedInSubmission: false,
        },
        {
          id: "included-pdf",
          bytes: pdf(18),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: true,
        },
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime({ "application/pdf:17": 110, "application/pdf:18": 2 }),
    );
    const files = new Map<string, Uint8Array>();
    const commands: Array<{ executable: string; argv: readonly string[] }> = [];
    const removed: string[] = [];
    const runtimeValue = createBidRasterRuntimeForTesting({
      now: () => 1_000,
      read: async (path: string) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error("missing-output");
        return bytes.slice();
      },
      remove: async (path: string) => {
        removed.push(path);
        files.delete(path);
      },
      run: async (spec: { readonly executable: string; readonly argv: readonly string[] }) => {
        commands.push(spec);
        if (spec.executable.endsWith("pdftoppm")) {
          const stem = spec.argv.at(-1);
          if (!stem) throw new Error("missing-stem");
          files.set(`${stem}.jpg`, rasterJpeg());
        }
        if (spec.executable.endsWith("vips")) {
          const output = spec.argv[2]?.replace(/\[.*$/u, "");
          if (!output) throw new Error("missing-output");
          files.set(output, rasterJpeg());
        }
      },
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes.slice());
      },
    });
    const images = await rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      undefined,
      runtimeValue,
    );
    expect(images.map(({ attachmentId, pageNumber }) => ({ attachmentId, pageNumber }))).toEqual([
      { attachmentId: "included-pdf", pageNumber: 1 },
      { attachmentId: "included-pdf", pageNumber: 2 },
      { attachmentId: "included-image", pageNumber: 1 },
    ]);
    expect(images.every((image) => image.widthPixels === 2 && image.heightPixels === 4)).toBe(true);
    expect(commands.map((command) => command.executable)).toEqual([
      "/usr/bin/pdfinfo",
      "/usr/bin/pdfinfo",
      "/usr/bin/pdftoppm",
      "/usr/bin/vips",
      "/usr/bin/pdftoppm",
      "/usr/bin/vips",
      "/usr/bin/vips",
    ]);
    expect(JSON.stringify(commands)).not.toMatch(
      /private-display-name|example\.invalid|sourceRef/u,
    );
    expect(removed).toHaveLength(8);
    expect(files.size).toBe(0);
  });

  it("maps raster runtime failures, abort and cleanup errors to one fixed error", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const failure = (value: unknown): boolean =>
      value instanceof Error && value.message === "CONVERSION_FAILED";

    let removed = 0;
    await expect(
      rasterizeBidAttachments(
        parsed,
        jobId,
        undefined,
        createBidRasterRuntimeForTesting({
          now: () => 1_000,
          read: async () => rasterJpeg(),
          remove: async () => {
            removed += 1;
          },
          run: async () => {
            throw new Error("PRIVATE_TOOL_SENTINEL");
          },
          write: async () => undefined,
        }),
      ),
    ).rejects.toSatisfy(failure);
    expect(removed).toBeGreaterThan(0);

    const controller = new AbortController();
    const pending = rasterizeBidAttachments(
      parsed,
      jobId,
      controller.signal,
      createBidRasterRuntimeForTesting({
        now: () => 1_000,
        read: async () => rasterJpeg(),
        remove: async () => undefined,
        run: async (_spec: unknown, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT_SENTINEL")), {
              once: true,
            });
          }),
        write: async () => undefined,
      }),
    );
    setImmediate(() => controller.abort());
    await expect(pending).rejects.toSatisfy(failure);

    await expect(
      rasterizeBidAttachments(
        parsed,
        jobId,
        undefined,
        createBidRasterRuntimeForTesting({
          now: () => 1_000,
          read: async () => rasterJpeg(),
          remove: async () => {
            throw new Error("PRIVATE_CLEANUP_SENTINEL");
          },
          run: async () => undefined,
          write: async () => undefined,
        }),
      ),
    ).rejects.toSatisfy(failure);
  });

  it("waits for the active command to settle before cleaning files after cancellation", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const controller = new AbortController();
    let runSettled = false;
    let cleanupBeforeRunSettled = false;
    const pending = rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      controller.signal,
      createBidRasterRuntimeForTesting({
        now: () => 1_000,
        read: async () => rasterJpeg(),
        remove: async () => {
          if (!runSettled) cleanupBeforeRunSettled = true;
        },
        run: async (_spec: unknown, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                setTimeout(() => {
                  runSettled = true;
                  reject(new Error("PRIVATE_DELAYED_STOP"));
                }, 50);
              },
              { once: true },
            );
          }),
        write: async () => undefined,
      }),
    );
    setImmediate(() => controller.abort());
    await expect(pending).rejects.toThrow("CONVERSION_FAILED");
    expect(runSettled).toBe(true);
    expect(cleanupBeforeRunSettled).toBe(false);
  });

  it("waits for a late source write to settle before removing its private path", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const controller = new AbortController();
    const files = new Map<string, Uint8Array>();
    const order: string[] = [];
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    const pending = rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      controller.signal,
      createBidRasterRuntimeForTesting({
        now: Date.now,
        read: async () => rasterJpeg(),
        remove: async (path: string) => {
          order.push("remove");
          files.delete(path);
        },
        run: async () => undefined,
        write: async (path: string, bytes: Uint8Array) => {
          writeStarted();
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          files.set(path, bytes.slice());
          order.push("write-settled");
        },
      }),
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow("CONVERSION_FAILED");
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    expect(order.indexOf("write-settled")).toBeLessThan(order.indexOf("remove"));
    expect(files.size).toBe(0);
  });

  it("waits for a late raster read to settle before removing generated files", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const controller = new AbortController();
    const order: string[] = [];
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const pending = rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      controller.signal,
      createBidRasterRuntimeForTesting({
        now: Date.now,
        read: async () => {
          readStarted();
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          order.push("read-settled");
          return rasterJpeg();
        },
        remove: async () => {
          order.push("remove");
        },
        run: async () => undefined,
        write: async () => undefined,
      }),
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow("CONVERSION_FAILED");
    expect(order.indexOf("read-settled")).toBeLessThan(order.indexOf("remove"));
  });

  it("keeps recovery state and skips deletion when an active write cannot be drained", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-image",
          bytes: png(),
          mediaType: "image/png",
          pageCount: 1,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const controller = new AbortController();
    const remove = vi.fn(async () => undefined);
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    const pending = rasterizeBidAttachments(
      parsed,
      "123e4567-e89b-42d3-a456-426614174000",
      controller.signal,
      createBidRasterRuntimeForTesting({
        now: Date.now,
        read: async () => rasterJpeg(),
        remove,
        run: async () => undefined,
        write: async () => {
          writeStarted();
          return new Promise<void>(() => undefined);
        },
      }),
    );
    await started;
    controller.abort();
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 4_000)),
    ]);
    expect(outcome).toBe("rejected");
    expect(remove).not.toHaveBeenCalled();
  }, 10_000);

  it("rejects hostile raster runtimes and keeps the production runtime private and frozen", () => {
    const getter = vi.fn(() => async () => undefined);
    const accessor = {
      now: () => 0,
      read: async () => rasterJpeg(),
      remove: async () => undefined,
      run: async () => undefined,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, "write", { enumerable: true, get: getter });
    expect(() => createBidRasterRuntimeForTesting(accessor)).toThrow("CONVERSION_FAILED");
    expect(getter).not.toHaveBeenCalled();
    expect(() => createBidRasterRuntimeForTesting(new Proxy(accessor, {}))).toThrow(
      "CONVERSION_FAILED",
    );
    expect(Object.isFrozen(createBidRasterRuntime())).toBe(true);
    expect(() => createBidRasterRuntime({ extra: true })).toThrow("CONVERSION_FAILED");
  });

  it("rejects linked parent directories in the production file runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentrad-raster-root-"));
    const redirect = await mkdtemp(join(tmpdir(), "opentrad-raster-redirect-"));
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const jobDirectory = join(root, jobId);
    const linkedAttachments = join(jobDirectory, "attachments");
    const result = join(redirect, "source-000.jpg");
    try {
      await mkdir(jobDirectory, { mode: 0o700 });
      await symlink(redirect, linkedAttachments);
      await writeFile(result, Uint8Array.of(9, 8, 7), { mode: 0o600 });
      const fileRuntime = createBidRasterFileRuntimeForTesting(root);
      await expect(
        fileRuntime.write(join(linkedAttachments, "source-000.jpg"), Uint8Array.of(1, 2, 3)),
      ).rejects.toThrow("CONVERSION_FAILED");
      await expect(
        fileRuntime.read(join(linkedAttachments, "source-000.jpg"), 25 * MiB),
      ).rejects.toThrow("CONVERSION_FAILED");
      await expect(fileRuntime.remove(join(linkedAttachments, "source-000.jpg"))).rejects.toThrow(
        "CONVERSION_FAILED",
      );
      await expect(readFile(result)).resolves.toEqual(Buffer.from([9, 8, 7]));

      await rm(linkedAttachments);
      await rm(jobDirectory, { recursive: true });
      await symlink(redirect, jobDirectory);
      await expect(
        fileRuntime.write(
          join(jobDirectory, "attachments", "source-000.jpg"),
          Uint8Array.of(1, 2, 3),
        ),
      ).rejects.toThrow("CONVERSION_FAILED");
      await expect(readFile(result)).resolves.toEqual(Buffer.from([9, 8, 7]));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(redirect, { recursive: true, force: true });
    }
  });

  it("rejects forged empty archive snapshots before doing any raster work", async () => {
    const calls: string[] = [];
    const rasterRuntime = createBidRasterRuntimeForTesting({
      now: () => 1_000,
      read: async () => {
        calls.push("read");
        return rasterJpeg();
      },
      remove: async () => {
        calls.push("remove");
      },
      run: async () => {
        calls.push("run");
      },
      write: async () => {
        calls.push("write");
      },
    });

    await expect(
      rasterizeBidAttachments(
        { attachments: [], evidence: Object.create(null) } as never,
        "123e4567-e89b-42d3-a456-426614174000",
        undefined,
        rasterRuntime,
      ),
    ).rejects.toThrow("CONVERSION_FAILED");
    expect(calls).toEqual([]);
  });

  it("does not call mutable array, byte or string prototype methods while rasterizing", async () => {
    const parsed = await parseCanonicalBidArchive(
      archive([
        {
          id: "included-pdf",
          bytes: pdf(),
          mediaType: "application/pdf",
          pageCount: 2,
          includedInSubmission: true,
        },
      ]),
      request,
      undefined,
      runtime(),
    );
    const files = new Map<string, Uint8Array>();
    let writtenBytes = 0;
    const rasterRuntime = createBidRasterRuntimeForTesting({
      now: () => 1_000,
      read: async (path: string) => files.get(path) ?? rasterJpeg(),
      remove: async (path: string) => {
        files.delete(path);
      },
      run: async (spec: { readonly executable: string; readonly argv: readonly string[] }) => {
        if (spec.executable.endsWith("pdftoppm")) {
          const stem = spec.argv[spec.argv.length - 1];
          if (stem) files.set(`${stem}.jpg`, rasterJpeg());
        } else if (spec.executable.endsWith("vips")) {
          const output = spec.argv[2]?.replace(/\[.*$/u, "");
          if (output) files.set(output, rasterJpeg());
        }
      },
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, copyCanonicalBidAttachmentBytes(parsed, 0, "included-pdf"));
        writtenBytes += bytes.byteLength;
      },
    });
    const originalMap = Array.prototype.map;
    const originalByteSlice = Uint8Array.prototype.slice;
    const originalStringSlice = String.prototype.slice;
    let images: readonly unknown[] | undefined;
    let failure: unknown;
    try {
      Array.prototype.map = () => {
        throw new Error("PRIVATE_ARRAY_SENTINEL");
      };
      Uint8Array.prototype.slice = () => {
        throw new Error("PRIVATE_BYTES_SENTINEL");
      };
      String.prototype.slice = () => {
        throw new Error("PRIVATE_STRING_SENTINEL");
      };
      images = await rasterizeBidAttachments(
        parsed,
        "123e4567-e89b-42d3-a456-426614174000",
        undefined,
        rasterRuntime,
      );
    } catch (error) {
      failure = error;
    } finally {
      Array.prototype.map = originalMap;
      Uint8Array.prototype.slice = originalByteSlice;
      String.prototype.slice = originalStringSlice;
    }
    expect(failure).toBeUndefined();
    expect(writtenBytes).toBeGreaterThan(0);
    expect(images).toHaveLength(2);
  });
});
