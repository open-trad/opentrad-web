import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  createBidAttachmentArchiveRuntime,
  createBidAttachmentArchiveRuntimeForTesting,
} from "../src/adapters/bidAttachmentRuntime.js";
import {
  createBidImageDecodeFileRuntimeForTesting,
  createBidImageDecodeRuntimeForTesting,
} from "../src/adapters/bidImageDecode.js";

async function pdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage();
  return document.save({ useObjectStreams: true });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(output.subarray(4, 8 + data.byteLength)));
  return output;
}

function png(corruptPixels = false): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, 1);
  new DataView(header.buffer).setUint32(4, 1);
  header.set([8, 2, 0, 0, 0], 8);
  const chunks = [
    chunk("IHDR", header),
    chunk(
      "IDAT",
      corruptPixels ? Uint8Array.of(0x78, 0x9c, 0, 0, 0) : deflateSync(Uint8Array.of(0, 0, 0, 0)),
    ),
    chunk("IEND", new Uint8Array()),
  ];
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const output = new Uint8Array(
    signature.byteLength + chunks.reduce((sum, item) => sum + item.byteLength, 0),
  );
  output.set(signature);
  let offset = signature.byteLength;
  for (const item of chunks) {
    output.set(item, offset);
    offset += item.byteLength;
  }
  return output;
}

describe("production bid archive inspection runtime", () => {
  it("binds the real safe inspector to the archive runtime without network input", async () => {
    const runtime = createBidAttachmentArchiveRuntime("123e4567-e89b-42d3-a456-426614174000");
    await expect(
      runtime.inspectAttachment(await pdf(), "application/pdf", 80, Date.now() + 10_000, undefined),
    ).resolves.toEqual({ pageCount: 1 });
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it("rejects caller-supplied runtime fields", () => {
    expect(() => createBidAttachmentArchiveRuntime()).toThrow("INVALID_REQUEST");
    expect(() => createBidAttachmentArchiveRuntime("not-a-job-id")).toThrow("INVALID_REQUEST");
  });

  it("does not invoke a poisoned string prototype while validating the file root", () => {
    const original = String.prototype.includes;
    let failure: unknown;
    let runtime: unknown;
    try {
      String.prototype.includes = () => {
        throw new Error("PRIVATE_STRING_SENTINEL");
      };
      try {
        runtime = createBidImageDecodeFileRuntimeForTesting("/private-work");
      } catch (error) {
        failure = error;
      }
    } finally {
      String.prototype.includes = original;
    }
    expect(failure).toBeUndefined();
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it("fully decodes every structural image through fixed vips stats and cleans private files", async () => {
    const commands: Array<{ readonly argv: readonly string[]; readonly executable: string }> = [];
    const files = new Map<string, Uint8Array>();
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
        if (files.get(spec.argv[1] ?? "")?.byteLength === png(true).byteLength) {
          throw new Error("decoder rejected pixels");
        }
        const output = spec.argv[2];
        if (output) files.set(output, Uint8Array.of(1));
      },
      verify: async (path: string) => files.has(path),
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes.slice());
      },
    });
    const runtime = createBidAttachmentArchiveRuntimeForTesting(
      "123e4567-e89b-42d3-a456-426614174000",
      decodeRuntime,
    );
    await expect(
      runtime.inspectAttachment(png(), "image/png", 1, Date.now() + 10_000, undefined),
    ).resolves.toEqual({ pageCount: 1 });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      executable: "/usr/bin/vips",
      argv: [
        "stats",
        "/work/123e4567-e89b-42d3-a456-426614174000/inspection/source-000.png",
        "/work/123e4567-e89b-42d3-a456-426614174000/inspection/stats-000.v",
      ],
    });
    expect(files.size).toBe(0);

    await expect(
      runtime.inspectAttachment(png(true), "image/png", 1, Date.now() + 10_000, undefined),
    ).rejects.toThrow("INVALID_REQUEST");
    expect(files.size).toBe(0);
  });

  it("rejects linked inspection parents before creating decoder input or output files", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentrad-bid-decode-root-"));
    const redirect = await mkdtemp(join(tmpdir(), "opentrad-bid-decode-redirect-"));
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const jobDirectory = join(root, jobId);
    const linkedInspection = join(jobDirectory, "inspection");
    try {
      await mkdir(jobDirectory, { mode: 0o700 });
      await symlink(redirect, linkedInspection);
      const runtime = createBidImageDecodeFileRuntimeForTesting(root);
      await expect(runtime.write(join(linkedInspection, "source-000.png"), png())).rejects.toThrow(
        "INVALID_REQUEST",
      );
      await expect(readFile(join(redirect, "source-000.png"))).rejects.toThrow();

      await rm(linkedInspection);
      await rm(jobDirectory, { recursive: true });
      await symlink(redirect, jobDirectory);
      await expect(
        runtime.write(join(jobDirectory, "inspection", "source-000.png"), png()),
      ).rejects.toThrow("INVALID_REQUEST");
      await expect(readFile(join(redirect, "inspection", "source-000.png"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(redirect, { recursive: true, force: true });
    }
  });

  it("refuses a nonempty inspection directory before a tool can follow a stale output link", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentrad-bid-decode-stale-root-"));
    const redirect = await mkdtemp(join(tmpdir(), "opentrad-bid-decode-stale-redirect-"));
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const inspection = join(root, jobId, "inspection");
    const sentinel = join(redirect, "sentinel.v");
    try {
      await mkdir(inspection, { recursive: true, mode: 0o700 });
      await symlink(sentinel, join(inspection, "stats-000.v"));
      const runtime = createBidImageDecodeFileRuntimeForTesting(root);
      await expect(runtime.write(join(inspection, "source-000.png"), png())).rejects.toThrow(
        "INVALID_REQUEST",
      );
      await expect(readFile(sentinel)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(redirect, { recursive: true, force: true });
    }
  });
});
