import { Blob as NodeBlob } from "node:buffer";
import type { v2 } from "@opentrad/document-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function portableAttachment(): v2.AttachmentRefV1 {
  return {
    id: "technical-spec",
    category: "technical",
    displayName: "技术规格.pdf",
    mediaType: "application/pdf",
    pageCount: 2,
    required: true,
    status: "attached",
    includedInSubmission: true,
  };
}

function localEnvelope(): v2.ProjectEnvelopeV2 {
  const portable = portableAttachment();
  return {
    formatVersion: "2.0.0",
    template: {
      id: "contract.sale.domestic-b2b.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    draft: {
      id: "contract-1",
      templateId: "contract.sale.domestic-b2b.v1",
      templateVersion: "1.0.0",
      attachments: [portable],
    },
    presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
    attachmentManifest: [
      {
        ...portable,
        localBlobKey: "contract.sale.domestic-b2b.v1@1.0.0:contract-1#technical-spec",
      },
    ],
  };
}

function registry(overrides: { documentId?: string } = {}): DocumentTemplateRegistry {
  return {
    get(id, version) {
      if (id !== "contract.sale.domestic-b2b.v1" || version !== "1.0.0") throw new Error();
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
            documentKind: "contract",
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
                    attachmentIds: draft.attachments.map((entry) => entry.id),
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
            disclaimers: ["contract-generation-note"],
            attachmentManifest: draft.attachments,
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

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
});

describe("V2 .opentrad project ZIP", () => {
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

  it("checks the 52 MiB project size before reading a Blob-like input", async () => {
    const arrayBuffer = vi.fn();
    await expect(
      importProjectV2Zip({ size: 52 * 1024 * 1024 + 1, arrayBuffer } as never, {
        registry: registry(),
      }),
    ).rejects.toThrow("项目包超过 52 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
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
});
