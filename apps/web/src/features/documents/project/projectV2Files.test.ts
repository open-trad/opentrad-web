import { Blob as NodeBlob } from "node:buffer";
import { v2 } from "@opentrad/document-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bidGovernmentGoodsJson from "../../../../../../packages/document-core/tests/fixtures/v2/bid-government-goods.json?raw";
import type { DocumentTemplateRegistry } from "../storage/documentRepository";
import {
  exportProjectV2Zip,
  importProjectV2Zip,
  type ProjectV2AttachmentFile,
} from "./projectV2Files";
import { preflightProjectZip } from "./zipPreflight";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function portableAttachment(overrides: Partial<v2.AttachmentRefV1> = {}): v2.AttachmentRefV1 {
  return {
    id: "technical-spec",
    category: "technical",
    displayName: "技术规格.pdf",
    mediaType: "application/pdf",
    pageCount: 2,
    required: true,
    status: "attached",
    includedInSubmission: true,
    ...overrides,
  };
}

function localEnvelope(
  attachments: readonly v2.AttachmentRefV1[] = [portableAttachment()],
  templateId: v2.ProjectEnvelopeV2["template"]["id"] = "contract.sale.domestic-b2b.v1",
): v2.ProjectEnvelopeV2 {
  return {
    formatVersion: "2.0.0",
    template: {
      id: templateId,
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft: {
      id: "contract-1",
      templateId,
      templateVersion: "1.0.0",
      attachments,
    },
    presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
    attachmentManifest: attachments.map((attachment) => ({
      ...attachment,
      localBlobKey: `${templateId}@1.0.0:contract-1#${attachment.id}`,
    })),
  };
}

function registry(overrides: { documentId?: string } = {}): DocumentTemplateRegistry {
  return {
    get(id, version) {
      if (
        !["contract.sale.domestic-b2b.v1", "bid.government.goods.v1"].includes(id) ||
        version !== "1.0.0"
      ) {
        throw new Error();
      }
      return {
        definition: { id, version, basisDate: "2026-08-19" },
        parseDraft(input) {
          return structuredClone(input);
        },
        compile(input) {
          const draft = input as v2.ProjectDraftV2 & {
            readonly attachments: readonly v2.AttachmentRefV1[];
          };
          return {
            schemaVersion: "2.0.0",
            documentId: overrides.documentId ?? draft.id,
            template: { id, version, basisDate: "2026-08-19" },
            documentKind: id.startsWith("bid.") ? "bid" : "contract",
            language: "zh-CN",
            title: { zhCN: "国内货物买卖合同" },
            pageDefaults: {
              size: "A4",
              orientation: "portrait",
              marginsMm: { top: 20, right: 18, bottom: 20, left: 18 },
            },
            sections: [
              {
                id: "attachments",
                blocks: [
                  {
                    type: "attachmentIndex",
                    id: "attachment-index",
                    attachmentIds: draft.attachments
                      .filter((entry) => entry.includedInSubmission)
                      .map((entry) => entry.id),
                  },
                  {
                    type: "signatureGroup",
                    id: "signatures",
                    signers: [
                      {
                        role: { zhCN: "卖方" },
                        name: "宁波卖方有限公司",
                        dateLabel: { zhCN: "日期" },
                      },
                    ],
                  },
                ],
              },
            ],
            watermarks: [],
            disclaimers: [id.startsWith("bid.") ? "bid-authority" : "contract-generation-note"],
            attachmentManifest: draft.attachments
              .filter((entry) => entry.includedInSubmission)
              .map(({ localBlobKey: _localBlobKey, sourceRef, ...entry }) => ({
                ...entry,
                ...(sourceRef &&
                !/^[a-z][a-z0-9+.-]*:/iu.test(sourceRef.trim()) &&
                !/^(?:\/|\\|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/iu.test(sourceRef.trim()) &&
                !(
                  sourceRef.includes("/") &&
                  /\.(?:pdf|png|jpe?g)(?:[?#].*)?$/iu.test(sourceRef.trim())
                ) &&
                !sourceRef.includes("\\")
                  ? { sourceRef }
                  : {}),
              })),
          };
        },
      };
    },
  };
}

function attachmentFile(): ProjectV2AttachmentFile {
  return {
    id: "technical-spec",
    mediaType: "application/pdf",
    pageCount: 2,
    bytes: bytes("%PDF-1.7\n%%EOF"),
  };
}

function realBidProject(): {
  envelope: v2.ProjectEnvelopeV2;
  attachments: ProjectV2AttachmentFile[];
} {
  const draft = JSON.parse(bidGovernmentGoodsJson) as Record<string, unknown>;
  const evidenceRefs = draft.evidenceRefs as Array<Record<string, unknown>>;
  draft.evidenceRefs = evidenceRefs.map((entry, index) =>
    index === 0
      ? { ...entry, sourceRef: "https://example.invalid/solicitation.pdf#page=18" }
      : entry,
  );
  const descriptors = draft.attachments as v2.AttachmentRefV1[];
  const key = `${draft.templateId as string}@${draft.templateVersion as string}:${draft.id as string}`;
  return {
    envelope: {
      formatVersion: "2.0.0",
      template: {
        id: "bid.government.goods.v1",
        version: "1.0.0",
        basisDate: "2026-08-19",
      },
      draft: draft as v2.ProjectDraftV2,
      presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
      attachmentManifest: descriptors.map((entry) => ({
        ...entry,
        ...(entry.status === "attached" ? { localBlobKey: `${key}#${entry.id}` } : {}),
      })),
    },
    attachments: descriptors
      .filter((entry) => entry.status === "attached")
      .map((entry) => ({
        id: entry.id,
        mediaType: entry.mediaType,
        pageCount: entry.pageCount ?? 1,
        bytes: bytes("%PDF-1.7\n%%EOF"),
      })),
  };
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of input) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function canonicalStoreZip(entries: readonly { path: string; data: Uint8Array }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = bytes(entry.path);
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
  const localBytes = concat(localParts);
  const centralBytes = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralBytes.byteLength, true);
  eocdView.setUint32(16, localBytes.byteLength, true);
  return concat([localBytes, centralBytes, eocd]);
}

function rewriteStoredEntry(
  archive: Uint8Array,
  path: string,
  rewrite: (data: Uint8Array) => Uint8Array,
): Uint8Array {
  const copy = new Uint8Array(archive);
  const report = preflightProjectZip(copy);
  const entryIndex = report.entries.findIndex((entry) => entry.path === path);
  const entry = report.entries[entryIndex];
  if (!entry) throw new Error("Missing fixture entry");
  const original = copy.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize);
  const changed = rewrite(original);
  if (changed.byteLength !== original.byteLength) throw new Error("Fixture rewrite changed length");
  copy.set(changed, entry.dataOffset);
  const checksum = crc32(changed);
  new DataView(copy.buffer).setUint32(entry.localHeaderOffset + 14, checksum, true);

  let centralOffset = report.centralDirectoryOffset;
  for (let index = 0; index <= entryIndex; index += 1) {
    if (index === entryIndex) {
      new DataView(copy.buffer).setUint32(centralOffset + 16, checksum, true);
      break;
    }
    const view = new DataView(copy.buffer);
    centralOffset +=
      46 +
      view.getUint16(centralOffset + 28, true) +
      view.getUint16(centralOffset + 30, true) +
      view.getUint16(centralOffset + 32, true);
  }
  return copy;
}

function rewriteArchiveEntry(
  archive: Uint8Array,
  path: string,
  rewrite: (data: Uint8Array) => Uint8Array,
): Uint8Array {
  const report = preflightProjectZip(archive);
  return canonicalStoreZip(
    report.entries.map((entry) => {
      const data = archive.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize);
      return { path: entry.path, data: entry.path === path ? rewrite(data) : data };
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
});

describe("V2 .opentrad project ZIP", () => {
  it("embeds and round-trips the canonical bidAssembly extension for bid exports only", async () => {
    const project = realBidProject();
    const blob = await exportProjectV2Zip({
      ...project,
      registry: v2.V2_TEMPLATE_REGISTRY,
      bidBodyPageCountHint: 3,
    } as Parameters<typeof exportProjectV2Zip>[0]);

    const imported = await importProjectV2Zip(blob, { registry: v2.V2_TEMPLATE_REGISTRY });
    expect(imported).toMatchObject({
      bidAssembly: {
        templateId: "bid.government.goods.v1",
        templateVersion: "1.0.0",
        body: { pageCount: 3 },
      },
      requiresUserConfirmation: true,
    });
    expect(imported.bidAssembly?.body.byteLength).toBeGreaterThan(0);
    expect(
      imported.bidAssembly?.attachmentManifest.map((attachment) => {
        if (attachment.status !== "attached") return attachment;
        const { byteLength: _byteLength, ...portable } = attachment;
        return portable;
      }),
    ).toEqual(imported.portableEnvelope.attachmentManifest);
    expect(imported.serverSubmission).toEqual({ allowed: true });

    const nonBid = await importProjectV2Zip(
      await exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [attachmentFile()],
        registry: registry(),
      }),
      { registry: registry() },
    );
    expect(nonBid.bidAssembly).toBeNull();
  });

  it("keeps legacy bid projects local-only with a fixed server-submission reason", async () => {
    const project = realBidProject();
    const currentBlob = await exportProjectV2Zip({
      ...project,
      registry: v2.V2_TEMPLATE_REGISTRY,
      bidBodyPageCountHint: 3,
    });
    const legacyBytes = rewriteArchiveEntry(
      new Uint8Array(await currentBlob.arrayBuffer()),
      "manifest.json",
      (data) => {
        const manifest = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
        delete manifest.bidAssembly;
        return bytes(JSON.stringify(manifest));
      },
    );
    const imported = await importProjectV2Zip(legacyBytes, { registry: v2.V2_TEMPLATE_REGISTRY });

    expect(imported.bidAssembly).toBeNull();
    expect(imported.serverSubmission).toEqual({
      allowed: false,
      code: "BID_ASSEMBLY_REQUIRED",
    });
    expect(imported.requiresUserConfirmation).toBe(true);
  });

  it("strictly cross-checks bidAssembly against the outer manifest, draft and files", async () => {
    const project = realBidProject();
    const current = new Uint8Array(
      await (
        await exportProjectV2Zip({
          ...project,
          registry: v2.V2_TEMPLATE_REGISTRY,
          bidBodyPageCountHint: 3,
        })
      ).arrayBuffer(),
    );
    const mutateManifest = (mutate: (manifest: Record<string, unknown>) => void): Uint8Array =>
      rewriteArchiveEntry(current, "manifest.json", (data) => {
        const manifest = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
        mutate(manifest);
        return bytes(JSON.stringify(manifest));
      });

    await expect(
      importProjectV2Zip(
        mutateManifest((manifest) => {
          const bidAssembly = manifest.bidAssembly as Record<string, unknown>;
          bidAssembly.unexpected = true;
        }),
        { registry: v2.V2_TEMPLATE_REGISTRY },
      ),
    ).rejects.toThrow("项目包 manifest 无效");

    await expect(
      importProjectV2Zip(
        mutateManifest((manifest) => {
          const bidAssembly = manifest.bidAssembly as Record<string, unknown>;
          const body = bidAssembly.body as Record<string, unknown>;
          body.byteLength = (body.byteLength as number) + 1;
        }),
        { registry: v2.V2_TEMPLATE_REGISTRY },
      ),
    ).rejects.toThrow("投标组装清单与正文长度不一致");

    await expect(
      importProjectV2Zip(
        mutateManifest((manifest) => {
          const bidAssembly = manifest.bidAssembly as Record<string, unknown>;
          const attachments = bidAssembly.attachmentManifest as Array<Record<string, unknown>>;
          const attachment = attachments[0];
          if (!attachment) throw new Error("missing fixture attachment");
          attachment.byteLength = (attachment.byteLength as number) + 1;
        }),
        { registry: v2.V2_TEMPLATE_REGISTRY },
      ),
    ).rejects.toThrow("项目包 manifest 无效");
  });

  it("keeps non-bid archives compatible without exposing bid server submission", async () => {
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope(),
      attachments: [attachmentFile()],
      registry: registry(),
    });
    const imported = await importProjectV2Zip(blob, { registry: registry() });

    expect(imported.bidAssembly).toBeNull();
    expect(imported.serverSubmission).toEqual({
      allowed: false,
      code: "NOT_A_BID_PROJECT",
    });
  });

  it("exports byte-identical canonical STORE archives and strips localBlobKey", async () => {
    const input = {
      envelope: localEnvelope(),
      attachments: [attachmentFile()],
      registry: registry(),
    };
    const first = await exportProjectV2Zip(input);
    const second = await exportProjectV2Zip(input);
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    expect(firstBytes).toEqual(secondBytes);

    const report = preflightProjectZip(firstBytes);
    expect(report.entries.map((entry) => entry.path)).toEqual([
      "manifest.json",
      "draft.json",
      "attachments/technical-spec.pdf",
    ]);
    expect(
      report.entries.every(
        (entry) =>
          entry.method === 0 &&
          entry.modifiedTime === 0 &&
          entry.modifiedDate === 0 &&
          entry.externalAttributes === 0,
      ),
    ).toBe(true);
    expect(new TextDecoder().decode(firstBytes)).not.toContain("localBlobKey");
  });

  it("purely parses, validates, and derives local keys without writing IndexedDB", async () => {
    const open = vi.spyOn(indexedDB, "open");
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope(),
      attachments: [attachmentFile()],
      registry: registry(),
    });
    const imported = await importProjectV2Zip(blob, { registry: registry() });

    expect(imported.envelope.formatVersion).toBe("2.0.0");
    expect(imported.envelope.attachmentManifest[0]?.localBlobKey).toBe(
      "contract.sale.domestic-b2b.v1@1.0.0:contract-1#technical-spec",
    );
    expect(imported.attachments[0]).toMatchObject({
      id: "technical-spec",
      mediaType: "application/pdf",
      pageCount: 2,
    });
    expect(imported.requiresUserConfirmation).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects mismatched signatures, descriptors, references, and registry compilation", async () => {
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [{ ...attachmentFile(), bytes: bytes("<html>") }],
        registry: registry(),
      }),
    ).rejects.toThrow("附件内容与类型不一致");
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [{ ...attachmentFile(), pageCount: 3 }],
        registry: registry(),
      }),
    ).rejects.toThrow("附件描述不一致");
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [attachmentFile()],
        registry: registry({ documentId: "other" }),
      }),
    ).rejects.toThrow("文档模型身份不一致");

    const originalRegistry = registry();
    const invalidReferenceRegistry: DocumentTemplateRegistry = {
      get(id, version) {
        const registration = originalRegistry.get(id, version);
        return {
          ...registration,
          compile(draft: unknown) {
            const model = registration.compile(draft) as v2.DocumentModelV2;
            return {
              ...model,
              sections: [
                {
                  id: "attachments",
                  blocks: [
                    {
                      type: "attachmentIndex",
                      id: "attachment-index",
                      attachmentIds: ["not-declared"],
                    },
                  ],
                },
              ],
            };
          },
        };
      },
    };
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [attachmentFile()],
        registry: invalidReferenceRegistry,
      }),
    ).rejects.toThrow();
  });

  it("rejects prototype, getter, proxy and revoked hostile export inputs without invoking getters", async () => {
    const getter = vi.fn(() => attachmentFile().bytes);
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.assign(hostile, attachmentFile());
    Object.defineProperty(hostile, "bytes", { enumerable: true, get: getter });
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [hostile as never],
        registry: registry(),
      }),
    ).rejects.toThrow("附件输入无效");
    expect(getter).not.toHaveBeenCalled();

    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [Object.create({ id: "technical-spec" }) as never],
        registry: registry(),
      }),
    ).rejects.toThrow("附件输入无效");
    const { proxy, revoke } = Proxy.revocable(attachmentFile(), {});
    revoke();
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope(),
        attachments: [proxy],
        registry: registry(),
      }),
    ).rejects.toThrow("附件输入无效");
  });

  it("rejects hostile top-level export requests without invoking the page-hint getter", async () => {
    let getterCalls = 0;
    const request = {
      envelope: localEnvelope([], "bid.government.goods.v1"),
      attachments: [],
      registry: registry(),
    } as Record<string, unknown>;
    Object.defineProperty(request, "bidBodyPageCountHint", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });

    await expect(
      exportProjectV2Zip(request as unknown as Parameters<typeof exportProjectV2Zip>[0]),
    ).rejects.toThrow("项目包输入无效");
    expect(getterCalls).toBe(0);

    const revoked = Proxy.revocable(
      {
        envelope: localEnvelope(),
        attachments: [attachmentFile()],
        registry: registry(),
      },
      {},
    );
    revoked.revoke();
    await expect(
      exportProjectV2Zip(revoked.proxy as Parameters<typeof exportProjectV2Zip>[0]),
    ).rejects.toThrow("项目包输入无效");
  });

  it("checks the 52 MiB project size before reading a Blob-like input", async () => {
    const arrayBuffer = vi.fn();
    await expect(
      importProjectV2Zip({ size: 52 * 1024 * 1024 + 1, arrayBuffer } as never, {
        registry: registry(),
      }),
    ).rejects.toThrow("项目包超过 52 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("orders entries by the final ASCII archive path, independent of id-prefix and extension", async () => {
    const image = portableAttachment({
      id: "a",
      displayName: "a.png",
      mediaType: "image/png",
      pageCount: 1,
    });
    const pdf = portableAttachment({ id: "a-z", displayName: "a-z.pdf" });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([image, pdf]),
      attachments: [
        {
          id: "a",
          mediaType: "image/png",
          pageCount: 1,
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        },
        { ...attachmentFile(), id: "a-z" },
      ],
      registry: registry(),
    });
    const paths = preflightProjectZip(new Uint8Array(await blob.arrayBuffer())).entries.map(
      (entry) => entry.path,
    );
    expect(paths).toEqual([
      "manifest.json",
      "draft.json",
      "attachments/a-z.pdf",
      "attachments/a.png",
    ]);
  });

  it("rejects hostile Blob-like getters, prototypes and revoked proxies without invoking getters", async () => {
    const sizeGetter = vi.fn(() => 0);
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "size", { enumerable: true, get: sizeGetter });
    Object.defineProperty(hostile, "arrayBuffer", {
      enumerable: true,
      value: vi.fn(async () => new ArrayBuffer(0)),
    });
    await expect(importProjectV2Zip(hostile as never, { registry: registry() })).rejects.toThrow(
      "项目包输入无效",
    );
    expect(sizeGetter).not.toHaveBeenCalled();

    await expect(
      importProjectV2Zip(Object.create({ size: 0 }) as never, { registry: registry() }),
    ).rejects.toThrow("项目包输入无效");
    const { proxy, revoke } = Proxy.revocable(
      { size: 0, arrayBuffer: async () => new ArrayBuffer(0) },
      {},
    );
    revoke();
    await expect(importProjectV2Zip(proxy, { registry: registry() })).rejects.toThrow(
      "项目包输入无效",
    );
  });

  it("reads Blob, Uint8Array and ArrayBuffer subclasses through native branded accessors", async () => {
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope(),
      attachments: [attachmentFile()],
      registry: registry(),
    });
    const archive = new Uint8Array(await blob.arrayBuffer());
    const sizeGetter = vi.fn();
    const blobReader = vi.fn();
    class InheritedBlob extends NodeBlob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        blobReader();
        return new ArrayBuffer(0);
      }
    }
    Object.defineProperty(InheritedBlob.prototype, "size", {
      configurable: true,
      get() {
        sizeGetter();
        return 0;
      },
    });
    await expect(
      importProjectV2Zip(new InheritedBlob([archive]), { registry: registry() }),
    ).resolves.toMatchObject({ requiresUserConfirmation: true });
    expect(sizeGetter).not.toHaveBeenCalled();
    expect(blobReader).not.toHaveBeenCalled();

    const byteLengthGetter = vi.fn();
    class InheritedBytes extends Uint8Array {
      override get byteLength(): number {
        byteLengthGetter();
        return 0;
      }
    }
    await expect(
      importProjectV2Zip(new InheritedBytes(archive), { registry: registry() }),
    ).resolves.toMatchObject({ requiresUserConfirmation: true });
    expect(byteLengthGetter).not.toHaveBeenCalled();

    const bufferLengthGetter = vi.fn();
    class InheritedBuffer extends ArrayBuffer {
      override get byteLength(): number {
        bufferLengthGetter();
        return 0;
      }
    }
    const inheritedBuffer = new InheritedBuffer(archive.byteLength);
    new Uint8Array(inheritedBuffer).set(archive);
    await expect(
      importProjectV2Zip(
        { size: archive.byteLength, arrayBuffer: async () => inheritedBuffer },
        { registry: registry() },
      ),
    ).resolves.toMatchObject({ requiresUserConfirmation: true });
    expect(bufferLengthGetter).not.toHaveBeenCalled();
  });

  it("rejects actual CRC corruption and strict manifest/draft mismatch after preflight", async () => {
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope(),
      attachments: [attachmentFile()],
      registry: registry(),
    });
    const archive = new Uint8Array(await blob.arrayBuffer());
    const report = preflightProjectZip(archive);
    const attachment = report.entries.find((entry) => entry.path.startsWith("attachments/"));
    if (!attachment) throw new Error("Missing attachment fixture");
    const corrupt = new Uint8Array(archive);
    const firstByte = corrupt[attachment.dataOffset];
    if (firstByte === undefined) throw new Error("Missing attachment byte");
    corrupt[attachment.dataOffset] = firstByte ^ 0xff;
    await expect(importProjectV2Zip(corrupt, { registry: registry() })).rejects.toThrow(
      "项目包 CRC 校验失败",
    );

    const mismatched = rewriteStoredEntry(archive, "manifest.json", (data) => {
      const text = new TextDecoder().decode(data);
      const changed = text.replace('"languageView":"zh-CN"', '"languageView":"en-US"');
      expect(changed).not.toBe(text);
      return bytes(changed);
    });
    await expect(importProjectV2Zip(mismatched, { registry: registry() })).rejects.toThrow(
      "manifest 与 draft 描述不一致",
    );

    const unknownKey = rewriteStoredEntry(archive, "manifest.json", (data) =>
      bytes(new TextDecoder().decode(data).replace('"files":', '"evilx":')),
    );
    await expect(importProjectV2Zip(unknownKey, { registry: registry() })).rejects.toThrow(
      "项目包 manifest 无效",
    );
  });

  it("rejects mixed-extension files that reuse one attachment id", async () => {
    const descriptor = portableAttachment({ id: "a", displayName: "a.pdf" });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([descriptor]),
      attachments: [{ ...attachmentFile(), id: "a" }],
      registry: registry(),
    });
    const archive = new Uint8Array(await blob.arrayBuffer());
    const report = preflightProjectZip(archive);
    const data = new Map(
      report.entries.map((entry) => [
        entry.path,
        archive.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize),
      ]),
    );
    const manifestBytes = data.get("manifest.json");
    const draftBytes = data.get("draft.json");
    const pdfBytes = data.get("attachments/a.pdf");
    if (!manifestBytes || !draftBytes || !pdfBytes) throw new Error("Missing fixture entry");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      files: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    manifest.files.unshift({
      id: "a",
      path: "attachments/a.jpg",
      mediaType: "image/jpeg",
      byteLength: 4,
      pageCount: 1,
    });
    const duplicateIdArchive = canonicalStoreZip([
      { path: "manifest.json", data: bytes(JSON.stringify(manifest)) },
      { path: "draft.json", data: draftBytes },
      { path: "attachments/a.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
      { path: "attachments/a.pdf", data: pdfBytes },
    ]);

    await expect(importProjectV2Zip(duplicateIdArchive, { registry: registry() })).rejects.toThrow(
      "项目包 manifest 无效",
    );
  });

  it("rejects an archive-supplied localBlobKey even when it matches the derived local key", async () => {
    const localBlobKey = "contract.sale.domestic-b2b.v1@1.0.0:contract-1#source-only";
    const sourceRef = `section-${"x".repeat(localBlobKey.length - 5)}`;
    expect(sourceRef.length).toBe(localBlobKey.length + 3);
    const descriptor = portableAttachment({
      id: "source-only",
      displayName: "采购方招标文件.pdf",
      pageCount: 1,
      includedInSubmission: false,
      sourceRef,
    });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([descriptor]),
      attachments: [{ ...attachmentFile(), id: "source-only", pageCount: 1 }],
      registry: registry(),
    });
    let archive: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    const rewriteOuterManifest = (data: Uint8Array): Uint8Array => {
      const text = new TextDecoder().decode(data);
      const start = text.indexOf('"attachmentManifest":[');
      expect(start).toBeGreaterThanOrEqual(0);
      const before = `"sourceRef":${JSON.stringify(sourceRef)}`;
      const after = `"localBlobKey":${JSON.stringify(localBlobKey)}`;
      expect(before.length).toBe(after.length);
      const position = text.indexOf(before, start);
      expect(position).toBeGreaterThan(start);
      return bytes(`${text.slice(0, position)}${after}${text.slice(position + before.length)}`);
    };
    archive = rewriteStoredEntry(archive, "manifest.json", rewriteOuterManifest);
    archive = rewriteStoredEntry(archive, "draft.json", rewriteOuterManifest);

    await expect(importProjectV2Zip(archive, { registry: registry() })).rejects.toThrow(
      "项目包不得包含本地 Blob 引用",
    );
  });

  it("enforces the bid body plus included attachment page limit on direct export", async () => {
    const atLimit = portableAttachment({ pageCount: 79 });
    const bidEnvelope = localEnvelope([atLimit], "bid.government.goods.v1");
    const atLimitBlob = await exportProjectV2Zip({
      envelope: bidEnvelope,
      attachments: [{ ...attachmentFile(), pageCount: 79 }],
      registry: registry(),
      bidBodyPageCountHint: 1,
    });
    expect(atLimitBlob).toBeInstanceOf(Blob);

    const overLimit = portableAttachment({ pageCount: 80 });
    await expect(
      exportProjectV2Zip({
        envelope: localEnvelope([overLimit], "bid.government.goods.v1"),
        attachments: [{ ...attachmentFile(), pageCount: 80 }],
        registry: registry(),
        bidBodyPageCountHint: 1,
      }),
    ).rejects.toThrow("投标组装清单无效");

    let overLimitArchive: Uint8Array = new Uint8Array(await atLimitBlob.arrayBuffer());
    const raisePageCount = (data: Uint8Array) => {
      const text = new TextDecoder().decode(data);
      const changed = text.replaceAll('"pageCount":79', '"pageCount":80');
      expect(changed).not.toBe(text);
      return bytes(changed);
    };
    overLimitArchive = rewriteStoredEntry(overLimitArchive, "manifest.json", raisePageCount);
    overLimitArchive = rewriteStoredEntry(overLimitArchive, "draft.json", raisePageCount);
    await expect(importProjectV2Zip(overLimitArchive, { registry: registry() })).rejects.toThrow(
      "项目包 manifest 无效",
    );
  });

  it("counts excluded bid source pages in storage but not in the 80-page submission budget", async () => {
    const excluded = portableAttachment({
      id: "source-only",
      displayName: "采购方招标文件.pdf",
      pageCount: 110,
      includedInSubmission: false,
    });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([excluded], "bid.government.goods.v1"),
      attachments: [{ ...attachmentFile(), id: "source-only", pageCount: 110 }],
      registry: registry(),
      bidBodyPageCountHint: 1,
    });
    const imported = await importProjectV2Zip(blob, { registry: registry() });

    expect(imported.bidAssembly?.attachmentManifest).toContainEqual(
      expect.objectContaining({
        id: "source-only",
        includedInSubmission: false,
        pageCount: 110,
      }),
    );
    expect(imported.serverSubmission).toEqual({ allowed: true });
  });

  it("backs up excluded source attachment bytes without publishing local refs in draft or model", async () => {
    const included = portableAttachment();
    const sourceOnly = portableAttachment({
      id: "source-only",
      displayName: "采购方招标文件.pdf",
      pageCount: 1,
      sourceRef: "https://example.invalid/private-source.pdf",
      includedInSubmission: false,
    });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([included, sourceOnly]),
      attachments: [attachmentFile(), { ...attachmentFile(), id: "source-only", pageCount: 1 }],
      registry: registry(),
    });
    const archive = new Uint8Array(await blob.arrayBuffer());

    expect(preflightProjectZip(archive).entries.map((entry) => entry.path)).toContain(
      "attachments/source-only.pdf",
    );
    expect(new TextDecoder().decode(archive)).not.toContain("example.invalid/private-source.pdf");
    const imported = await importProjectV2Zip(archive, { registry: registry() });
    expect(imported.attachments.map((entry) => entry.id)).toEqual([
      "source-only",
      "technical-spec",
    ]);
    expect(imported.portableEnvelope.attachmentManifest).toContainEqual(
      expect.objectContaining({
        id: "source-only",
        includedInSubmission: false,
      }),
    );
    expect(imported.portableEnvelope.attachmentManifest[1]).not.toHaveProperty("sourceRef");
    expect(imported.model.attachmentManifest.map((entry) => entry.id)).toEqual(["technical-spec"]);
  });

  it("round-trips a real bid while preserving required solicitation evidence sourceRef", async () => {
    const project = realBidProject();

    const blob = await exportProjectV2Zip({
      ...project,
      registry: v2.V2_TEMPLATE_REGISTRY,
      bidBodyPageCountHint: 1,
    });
    const imported = await importProjectV2Zip(blob, { registry: v2.V2_TEMPLATE_REGISTRY });
    const evidenceRefs = imported.portableEnvelope.draft.evidenceRefs as Array<
      Record<string, unknown>
    >;

    expect(evidenceRefs[0]?.sourceRef).toBe("https://example.invalid/solicitation.pdf#page=18");
    expect(imported.model.documentKind).toBe("bid");
  });

  it.each(["private/contracts/source.pdf", "Users/example/private.pdf"])(
    "strips the relative local attachment path %s from the portable archive",
    async (sourceRef) => {
      const descriptor = portableAttachment({ sourceRef });
      const blob = await exportProjectV2Zip({
        envelope: localEnvelope([descriptor]),
        attachments: [attachmentFile()],
        registry: registry(),
      });
      const archive = new TextDecoder().decode(await blob.arrayBuffer());

      expect(archive).not.toContain(sourceRef);
      const imported = await importProjectV2Zip(blob, { registry: registry() });
      expect(imported.portableEnvelope.attachmentManifest[0]).not.toHaveProperty("sourceRef");
    },
  );

  it("preserves a safe slash-delimited attachment business reference", async () => {
    const descriptor = portableAttachment({ sourceRef: "第三章/2.1" });
    const blob = await exportProjectV2Zip({
      envelope: localEnvelope([descriptor]),
      attachments: [attachmentFile()],
      registry: registry(),
    });

    expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain("第三章/2.1");
    const imported = await importProjectV2Zip(blob, { registry: registry() });
    expect(imported.portableEnvelope.attachmentManifest[0]?.sourceRef).toBe("第三章/2.1");
  });
});
