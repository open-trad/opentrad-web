import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPixelLimit,
  convertEncodedImage,
  convertImage,
  dispatchImageConversion,
  IMAGE_LIMITS,
  inspectImageBytes,
  installLocalConversionWorker,
} from "../src/index.js";

const codecMocks = vi.hoisted(() => ({
  avifDecode: vi.fn(),
  avifEncode: vi.fn(),
  jpegDecode: vi.fn(),
  jpegEncode: vi.fn(),
  webpDecode: vi.fn(),
  webpEncode: vi.fn(),
}));

vi.mock("@jsquash/avif/decode.js", () => ({ default: codecMocks.avifDecode }));
vi.mock("@jsquash/avif/encode.js", () => ({ default: codecMocks.avifEncode }));
vi.mock("@jsquash/jpeg/decode.js", () => ({ default: codecMocks.jpegDecode }));
vi.mock("@jsquash/jpeg/encode.js", () => ({ default: codecMocks.jpegEncode }));
vi.mock("@jsquash/webp/decode.js", () => ({ default: codecMocks.webpDecode }));
vi.mock("@jsquash/webp/encode.js", () => ({ default: codecMocks.webpEncode }));

const ascii = new TextEncoder();

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u24le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function u32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = ascii.encode(type);
  const body = concat(name, data);
  return concat(u32be(data.byteLength), body, u32be(crc32(body)));
}

function png(
  width: number,
  height: number,
  options: { readonly alpha?: boolean; readonly chunks?: readonly Uint8Array[] } = {},
): Uint8Array {
  const ihdr = concat(
    u32be(width),
    u32be(height),
    new Uint8Array([8, options.alpha === false ? 2 : 6, 0, 0, 0]),
  );
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    ...(options.chunks ?? []),
    pngChunk("IDAT", new Uint8Array()),
    pngChunk("IEND", new Uint8Array()),
  );
}

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0xff, marker]), u16be(data.byteLength + 2), data);
}

function jpeg(width: number, height: number, segments: readonly Uint8Array[] = []): Uint8Array {
  const sof = concat(
    new Uint8Array([8]),
    u16be(height),
    u16be(width),
    new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
  );
  return concat(
    new Uint8Array([0xff, 0xd8]),
    ...segments,
    jpegSegment(0xc0, sof),
    new Uint8Array([0xff, 0xd9]),
  );
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  return concat(
    ascii.encode(type),
    u32le(data.byteLength),
    data,
    data.byteLength % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(),
  );
}

function webp(
  width: number,
  height: number,
  options: {
    readonly alpha?: boolean;
    readonly animated?: boolean;
    readonly chunks?: readonly Uint8Array[];
    readonly losslessAlpha?: boolean;
    readonly losslessVersion?: number;
  } = {},
): Uint8Array {
  const flags = (options.alpha ? 0x10 : 0) | (options.animated ? 0x02 : 0);
  const vp8x = riffChunk(
    "VP8X",
    concat(new Uint8Array([flags, 0, 0, 0]), u24le(width - 1), u24le(height - 1)),
  );
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  const vp8lDimensions = new Uint8Array([
    0x2f,
    widthMinusOne & 0xff,
    ((widthMinusOne >>> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6),
    (heightMinusOne >>> 2) & 0xff,
    ((heightMinusOne >>> 10) & 0x0f) |
      ((options.losslessAlpha ?? options.alpha ?? false) ? 0x10 : 0) |
      (((options.losslessVersion ?? 0) & 0x07) << 5),
  ]);
  const body = concat(vp8x, ...(options.chunks ?? []), riffChunk("VP8L", vp8lDimensions));
  return concat(ascii.encode("RIFF"), u32le(body.byteLength + 4), ascii.encode("WEBP"), body);
}

function isoBox(type: string, data: Uint8Array): Uint8Array {
  return concat(u32be(data.byteLength + 8), ascii.encode(type), data);
}

function fullBox(type: string, version: number, data: Uint8Array): Uint8Array {
  return isoBox(type, concat(new Uint8Array([version, 0, 0, 0]), data));
}

function avif(
  width: number,
  height: number,
  options: {
    readonly alpha?: boolean;
    readonly alphaDimensions?: { readonly height: number; readonly width: number };
    readonly auxType?: string;
    readonly auxVersion?: number;
    readonly associated?: boolean;
    readonly sequence?: boolean;
    readonly boxes?: readonly Uint8Array[];
    readonly exifItem?: boolean;
    readonly extraAssociationId?: number;
    readonly extraLocationId?: number;
    readonly extentOffset?: number;
  } = {},
): Uint8Array {
  const brand = options.sequence ? "avis" : "avif";
  const ftyp = isoBox("ftyp", concat(ascii.encode(brand), u32be(0), ascii.encode(brand)));
  const ispe = fullBox("ispe", 0, concat(u32be(width), u32be(height)));
  const alpha = options.alpha
    ? fullBox(
        "auxC",
        options.auxVersion ?? 0,
        ascii.encode(`${options.auxType ?? "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha"}\0`),
      )
    : new Uint8Array();
  const alphaIspe = options.alphaDimensions
    ? fullBox(
        "ispe",
        0,
        concat(u32be(options.alphaDimensions.width), u32be(options.alphaDimensions.height)),
      )
    : new Uint8Array();
  const alphaIspeIndex = options.alphaDimensions ? 2 : 1;
  const alphaPropertyIndex = options.alphaDimensions ? 3 : 2;
  const ipco = isoBox("ipco", concat(ispe, alphaIspe, alpha));
  const baseAssociations = options.alpha
    ? concat(
        u32be(2),
        u16be(1),
        new Uint8Array([1, 0x81]),
        u16be(2),
        new Uint8Array([2, 0x80 | alphaIspeIndex, 0x80 | alphaPropertyIndex]),
      )
    : concat(u32be(1), u16be(1), new Uint8Array([1, 0x81]));
  const associations = options.extraAssociationId
    ? concat(
        u32be(2),
        u16be(1),
        new Uint8Array([1, 0x81]),
        u16be(options.extraAssociationId),
        new Uint8Array([1, 0x81]),
      )
    : baseAssociations;
  const ipma = fullBox("ipma", 0, associations);
  const iprp = isoBox("iprp", concat(ipco, ipma));
  const primaryInfo = fullBox(
    "infe",
    2,
    concat(u16be(1), u16be(0), ascii.encode("av01"), ascii.encode("primary\0")),
  );
  const exifInfo = options.exifItem
    ? fullBox(
        "infe",
        2,
        concat(
          u16be(options.alpha ? 3 : 2),
          u16be(0),
          ascii.encode("Exif"),
          ascii.encode("metadata\0"),
        ),
      )
    : new Uint8Array();
  const alphaInfo = options.alpha
    ? fullBox("infe", 2, concat(u16be(2), u16be(0), ascii.encode("av01"), ascii.encode("alpha\0")))
    : new Uint8Array();
  const itemCount = 1 + (options.alpha ? 1 : 0) + (options.exifItem ? 1 : 0);
  const iinf = fullBox("iinf", 0, concat(u16be(itemCount), primaryInfo, alphaInfo, exifInfo));
  const iref = options.alpha
    ? fullBox("iref", 0, isoBox("auxl", concat(u16be(2), u16be(1), u16be(1))))
    : new Uint8Array();
  const makeIloc = (payloadOffset: number): Uint8Array => {
    const admittedOffset = options.extentOffset ?? payloadOffset;
    const entries = options.alpha
      ? concat(
          u16be(1),
          u16be(0),
          u16be(1),
          u32be(admittedOffset),
          u32be(1),
          u16be(2),
          u16be(0),
          u16be(1),
          u32be(admittedOffset + 1),
          u32be(1),
        )
      : concat(u16be(1), u16be(0), u16be(1), u32be(admittedOffset), u32be(1));
    const withExtraLocation = options.extraLocationId
      ? concat(
          entries,
          u16be(options.extraLocationId),
          u16be(0),
          u16be(1),
          u32be(admittedOffset),
          u32be(1),
        )
      : entries;
    return fullBox(
      "iloc",
      0,
      concat(
        new Uint8Array([0x44, 0]),
        u16be((options.alpha ? 2 : 1) + (options.extraLocationId ? 1 : 0)),
        withExtraLocation,
      ),
    );
  };
  const associationBoxes =
    options.associated === false
      ? new Uint8Array()
      : concat(fullBox("pitm", 0, u16be(1)), iinf, iref);
  const makeMeta = (payloadOffset: number): Uint8Array =>
    fullBox("meta", 0, concat(associationBoxes, makeIloc(payloadOffset), iprp));
  const extraBoxes = concat(...(options.boxes ?? []));
  let meta = makeMeta(0);
  const payloadOffset = ftyp.byteLength + meta.byteLength + extraBoxes.byteLength + 8;
  meta = makeMeta(payloadOffset);
  return concat(
    ftyp,
    meta,
    extraBoxes,
    isoBox("mdat", new Uint8Array(options.alpha ? [0, 0] : [0])),
  );
}

function imageData(
  width = 1,
  height = 1,
  data = new Uint8ClampedArray([255, 0, 0, 255]),
): ImageData {
  return { colorSpace: "srgb", data, height, width } as ImageData;
}

class ImageWorkerScope {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly posts: unknown[] = [];
  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.posts.push(structuredClone(message, { transfer }));
  }
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
}

beforeEach(() => {
  codecMocks.avifDecode.mockReset().mockResolvedValue(imageData());
  codecMocks.jpegDecode.mockReset().mockResolvedValue(imageData());
  codecMocks.webpDecode.mockReset().mockResolvedValue(imageData());
  codecMocks.avifEncode.mockReset().mockResolvedValue(avif(1, 1).buffer);
  codecMocks.jpegEncode.mockReset().mockResolvedValue(jpeg(1, 1).buffer);
  codecMocks.webpEncode.mockReset().mockResolvedValue(webp(1, 1).buffer);
});

describe("image container admission", () => {
  it("publishes strict dimension, pixel, metadata, and file limits", () => {
    expect(IMAGE_LIMITS).toMatchObject({
      maxAlphaPixels: 20_000_000,
      maxDimension: 16_384,
      maxExifBytes: 256 * 1024,
      maxFrames: 1,
      maxIccBytes: 512 * 1024,
      maxInputBytes: 25 * 1024 * 1024,
      maxOutputBytes: 25 * 1024 * 1024,
      maxPixels: 40_000_000,
    });
    expect(Object.getPrototypeOf(IMAGE_LIMITS)).toBeNull();
    expect(Object.isFrozen(IMAGE_LIMITS)).toBe(true);
    expect(() => assertPixelLimit(5_000, 8_000)).not.toThrow();
    for (const [width, height] of [
      [50_000, 1],
      [1, 50_000],
      [50_000, 50_000],
      [0, 1],
      [1.5, 1],
      [Number.NaN, 1],
    ] as const) {
      expect(() => assertPixelLimit(width, height)).toThrow("IMAGE_PIXEL_LIMIT");
    }
  });

  it("detects PNG, JPEG, WebP, and AVIF by magic and exact dimensions", () => {
    expect(inspectImageBytes(png(320, 240), "png")).toMatchObject({
      format: "png",
      width: 320,
      height: 240,
      frameCount: 1,
      hasAlpha: true,
    });
    expect(inspectImageBytes(jpeg(640, 480), "jpg")).toMatchObject({
      format: "jpg",
      width: 640,
      height: 480,
      frameCount: 1,
    });
    expect(inspectImageBytes(webp(800, 600), "webp")).toMatchObject({
      format: "webp",
      width: 800,
      height: 600,
      frameCount: 1,
    });
    expect(inspectImageBytes(avif(1920, 1080), "avif")).toMatchObject({
      format: "avif",
      width: 1920,
      height: 1080,
      frameCount: 1,
    });
  });

  it("rejects mismatched MIME declarations, unknown magic, and pixel bombs before decode", async () => {
    expect(() => inspectImageBytes(png(1, 1), "jpg")).toThrow("IMAGE_FORMAT_MISMATCH");
    expect(() => inspectImageBytes(ascii.encode("GIF89a"), "png")).toThrow("IMAGE_FORMAT_INVALID");
    await expect(convertEncodedImage(png(50_000, 50_000), "png", "webp", 80)).rejects.toThrow(
      "IMAGE_PIXEL_LIMIT",
    );
    expect(codecMocks.webpEncode).not.toHaveBeenCalled();
  });

  it("rejects animated or multi-image containers instead of treating the first frame as still", () => {
    const apng = png(1, 1, { chunks: [pngChunk("acTL", concat(u32be(2), u32be(0)))] });
    const animatedWebp = webp(1, 1, { animated: true });
    const mpo = jpeg(1, 1, [jpegSegment(0xe2, concat(ascii.encode("MPF\0"), u32be(0)))]);
    const sequenceAvif = avif(1, 1, { sequence: true });
    for (const [bytes, format] of [
      [apng, "png"],
      [animatedWebp, "webp"],
      [mpo, "jpg"],
      [sequenceAvif, "avif"],
    ] as const) {
      expect(() => inspectImageBytes(bytes, format)).toThrow("IMAGE_MULTIFRAME_UNSUPPORTED");
    }
  });

  it("bounds alpha, EXIF, ICC, and chunk counts before allocating decoded pixels", () => {
    expect(() => inspectImageBytes(png(5_000, 5_000), "png")).toThrow("IMAGE_ALPHA_LIMIT");

    const exifChunks = Array.from({ length: 5 }, () =>
      jpegSegment(0xe1, concat(ascii.encode("Exif\0\0"), new Uint8Array(60 * 1024))),
    );
    expect(() => inspectImageBytes(jpeg(1, 1, exifChunks), "jpg")).toThrow("IMAGE_METADATA_LIMIT");

    const iccChunks = Array.from({ length: 9 }, (_, index) =>
      jpegSegment(
        0xe2,
        concat(
          ascii.encode("ICC_PROFILE\0"),
          new Uint8Array([index + 1, 9]),
          new Uint8Array(60 * 1024),
        ),
      ),
    );
    expect(() => inspectImageBytes(jpeg(1, 1, iccChunks), "jpg")).toThrow("IMAGE_METADATA_LIMIT");

    const tooManyChunks = Array.from({ length: IMAGE_LIMITS.maxChunks + 1 }, () =>
      pngChunk("tEXt", new Uint8Array()),
    );
    expect(() => inspectImageBytes(png(1, 1, { chunks: tooManyChunks }), "png")).toThrow(
      "IMAGE_CHUNK_LIMIT",
    );
  });

  it("derives VP8L alpha from its lossless header and applies the alpha pixel budget", () => {
    expect(() => inspectImageBytes(webp(5_000, 5_000, { alpha: true }), "webp")).toThrow(
      "IMAGE_ALPHA_LIMIT",
    );
    expect(() =>
      inspectImageBytes(webp(5_000, 5_000, { alpha: false, losslessAlpha: true }), "webp"),
    ).toThrow("IMAGE_FORMAT_INVALID");
  });

  it("rejects non-zero VP8L lossless format versions", () => {
    expect(() => inspectImageBytes(webp(1, 1, { losslessVersion: 1 }), "webp")).toThrow(
      "IMAGE_FORMAT_INVALID",
    );
  });

  it("requires AVIF primary-item property association and rejects Exif items fail-closed", () => {
    expect(() => inspectImageBytes(avif(1, 1, { associated: false }), "avif")).toThrow(
      "IMAGE_FORMAT_INVALID",
    );
    expect(() => inspectImageBytes(avif(1, 1, { exifItem: true }), "avif")).toThrow(
      "IMAGE_METADATA_LIMIT",
    );
  });

  it("requires alpha-item dimensions to equal the AVIF primary item", () => {
    expect(() =>
      inspectImageBytes(
        avif(1, 1, { alpha: true, alphaDimensions: { height: 4_000, width: 4_000 } }),
        "avif",
      ),
    ).toThrow("IMAGE_FORMAT_INVALID");
  });

  it("requires every AVIF item extent to lie inside the mdat payload", () => {
    expect(() => inspectImageBytes(avif(1, 1, { extentOffset: 0 }), "avif")).toThrow(
      "IMAGE_FORMAT_INVALID",
    );
  });

  it("accepts only the exact AVIF alpha auxiliary property", () => {
    for (const bytes of [
      avif(1, 1, { alpha: true, auxType: "urn:mpeg:mpegB:cicp:systems:auxiliary:depth" }),
      avif(1, 1, { alpha: true, auxVersion: 1 }),
    ]) {
      expect(() => inspectImageBytes(bytes, "avif")).toThrow("IMAGE_FORMAT_INVALID");
    }
  });

  it("requires AVIF item, association, and location ID sets to match exactly", () => {
    expect(() => inspectImageBytes(avif(1, 1, { extraAssociationId: 2 }), "avif")).toThrow(
      "IMAGE_FORMAT_INVALID",
    );
    expect(() => inspectImageBytes(avif(1, 1, { extraLocationId: 2 }), "avif")).toThrow(
      "IMAGE_FORMAT_INVALID",
    );
  });

  it("rejects compressed PNG ICC profiles until their expanded size can be admitted", () => {
    const compressedProfile = concat(ascii.encode("OpenTrad\0"), new Uint8Array([0, 1, 2, 3]));
    expect(() =>
      inspectImageBytes(png(1, 1, { chunks: [pngChunk("iCCP", compressedProfile)] }), "png"),
    ).toThrow("IMAGE_METADATA_LIMIT");
  });
});

describe("bounded deterministic image conversion", () => {
  it("validates ImageData shape and quality without invoking codecs", async () => {
    class Pixels extends Uint8ClampedArray {}
    for (const invalid of [
      imageData(1, 1, new Uint8ClampedArray([1, 2, 3])),
      imageData(1, 1, new Pixels([1, 2, 3, 4])),
      { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) } as unknown as ImageData,
    ]) {
      await expect(convertImage(invalid, "webp", 80)).rejects.toThrow("IMAGE_DATA_INVALID");
    }
    for (const quality of [0, 101, 1.5, Number.NaN]) {
      await expect(convertImage(imageData(), "webp", quality)).rejects.toThrow(
        "IMAGE_QUALITY_INVALID",
      );
    }
    expect(codecMocks.webpEncode).not.toHaveBeenCalled();
  });

  it("rejects resizable pixel backing buffers before invoking a codec", async () => {
    if (!Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")) return;
    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      byteLength: number,
      options: { maxByteLength: number },
    ) => ArrayBuffer;
    const backing = new ResizableArrayBuffer(4, { maxByteLength: 8 });
    const pixels = new Uint8ClampedArray(backing);

    await expect(convertImage(imageData(1, 1, pixels), "webp", 80)).rejects.toThrow(
      "IMAGE_DATA_INVALID",
    );
    expect(codecMocks.webpEncode).not.toHaveBeenCalled();
  });

  it("encodes AVIF, WebP, and JPEG locally with bounded explicit options", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    try {
      await expect(convertImage(imageData(), "avif", 60)).resolves.toEqual(avif(1, 1));
      await expect(convertImage(imageData(), "webp", 60)).resolves.toEqual(webp(1, 1));
      await expect(convertImage(imageData(), "jpg", 60)).resolves.toEqual(jpeg(1, 1));
      expect(codecMocks.avifEncode).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1, height: 1 }),
        expect.objectContaining({ bitDepth: 8, quality: 60, speed: 6 }),
      );
      expect(codecMocks.webpEncode).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1, height: 1 }),
        expect.objectContaining({ exact: 1, method: 4, quality: 60 }),
      );
      expect(codecMocks.jpegEncode).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1, height: 1 }),
        expect.objectContaining({
          arithmetic: false,
          baseline: true,
          progressive: false,
          quality: 60,
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("flattens alpha onto white before JPEG and leaves the caller pixels unchanged", async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 0, 128]);
    const original = pixels.slice();
    codecMocks.jpegEncode.mockResolvedValueOnce(jpeg(2, 1).buffer);
    await convertImage(imageData(2, 1, pixels), "jpg", 80);
    const encoded = codecMocks.jpegEncode.mock.calls[0]?.[0] as ImageData;
    expect([...encoded.data]).toEqual([255, 255, 255, 255, 127, 127, 127, 255]);
    expect(pixels).toEqual(original);
  });

  it("produces a local PNG and rejects wrong-magic or oversized codec output", async () => {
    const output = await convertImage(imageData(), "png", 80);
    expect(output.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(inspectImageBytes(output, "png")).toMatchObject({ width: 1, height: 1 });

    codecMocks.avifEncode.mockResolvedValueOnce(ascii.encode("not avif").buffer);
    await expect(convertImage(imageData(), "avif", 80)).rejects.toThrow("IMAGE_ENCODE_FAILED");

    codecMocks.webpEncode.mockResolvedValueOnce(new ArrayBuffer(IMAGE_LIMITS.maxOutputBytes + 1));
    await expect(convertImage(imageData(), "webp", 80)).rejects.toThrow("IMAGE_OUTPUT_TOO_LARGE");
  });

  it("decodes admitted bytes, strips metadata by re-encoding, and verifies decoded dimensions", async () => {
    const source = jpeg(1, 1, [jpegSegment(0xe1, concat(ascii.encode("Exif\0\0"), u32be(1)))]);
    await expect(convertEncodedImage(source, "jpg", "webp", 70)).resolves.toEqual(webp(1, 1));
    expect(codecMocks.jpegDecode).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ preserveOrientation: false }),
    );
    expect(codecMocks.webpEncode).toHaveBeenCalledOnce();

    codecMocks.jpegDecode.mockResolvedValueOnce(imageData(2, 1, new Uint8ClampedArray(8)));
    await expect(convertEncodedImage(source, "jpg", "webp", 70)).rejects.toThrow(
      "IMAGE_DECODE_MISMATCH",
    );
  });

  it("honors abort checkpoints and never preserves abort reasons or codec errors", async () => {
    const before = new AbortController();
    before.abort({ filename: "private.jpg", bytes: [1, 2, 3] });
    await expect(convertImage(imageData(), "webp", 80, before.signal)).rejects.toThrow(
      "LOCAL_CONVERSION_CANCELLED",
    );

    codecMocks.webpEncode.mockRejectedValueOnce(
      Object.assign(new Error("private.jpg pixels"), { cause: new Uint8Array([1, 2, 3]) }),
    );
    let caught: unknown;
    try {
      await convertImage(imageData(), "webp", 80);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: "Error", message: "IMAGE_ENCODE_FAILED" });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(caught)).not.toMatch(/private|pixels/i);
  });

  it("settles a codec conversion promptly when aborted in flight and ignores its late result", async () => {
    let finishEncode: ((value: ArrayBuffer) => void) | undefined;
    codecMocks.webpEncode.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishEncode = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = convertImage(imageData(), "webp", 80, controller.signal);
    await vi.waitFor(() => expect(codecMocks.webpEncode).toHaveBeenCalledOnce());

    controller.abort({ filename: "private.webp", bytes: [1, 2, 3] });
    const observed = await Promise.race([
      pending.then(
        () => "resolved",
        (error: unknown) => (error as Error).message,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("still pending"), 25)),
    ]);
    finishEncode?.(webp(1, 1).buffer as ArrayBuffer);

    expect(observed).toBe("LOCAL_CONVERSION_CANCELLED");
  });

  it("closes a decoded PNG bitmap that arrives after cancellation", async () => {
    const close = vi.fn();
    let finishDecode: ((value: ImageBitmap) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finishDecode = resolve;
        }),
    );
    vi.stubGlobal("createImageBitmap", create);
    vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
    try {
      const controller = new AbortController();
      const pending = convertEncodedImage(png(1, 1), "png", "webp", 80, controller.signal);
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
      controller.abort({ filename: "private.png" });
      await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");

      finishDecode?.({ close, height: 1, width: 1 } as unknown as ImageBitmap);
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels the PNG compression reader after a bounded-output failure", async () => {
    const cancel = vi.fn();
    const oversized: Uint8Array<ArrayBuffer> = new Uint8Array(IMAGE_LIMITS.maxOutputBytes + 1);
    const readable = new ReadableStream<Uint8Array<ArrayBuffer>>({
      cancel,
      start(controller) {
        controller.enqueue(oversized);
      },
    });
    const readableSpy = vi
      .spyOn(CompressionStream.prototype, "readable", "get")
      .mockReturnValue(readable);
    try {
      await expect(convertImage(imageData(), "png", 80)).rejects.toThrow("IMAGE_OUTPUT_TOO_LARGE");
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    } finally {
      readableSpy.mockRestore();
    }
  });

  it("resolves every jSquash codec WASM reference to a packaged local asset", async () => {
    const require = createRequire(import.meta.url);
    for (const moduleName of [
      "@jsquash/avif/codec/dec/avif_dec.js",
      "@jsquash/avif/codec/enc/avif_enc.js",
      "@jsquash/avif/codec/enc/avif_enc_mt.js",
      "@jsquash/jpeg/codec/dec/mozjpeg_dec.js",
      "@jsquash/jpeg/codec/enc/mozjpeg_enc.js",
      "@jsquash/webp/codec/dec/webp_dec.js",
      "@jsquash/webp/codec/enc/webp_enc.js",
      "@jsquash/webp/codec/enc/webp_enc_simd.js",
    ]) {
      const modulePath = require.resolve(moduleName);
      const source = await readFile(modulePath, "utf8");
      const match = /new URL\(["']([^"']+\.wasm)["'],\s*import\.meta\.url\)/u.exec(source);
      expect(match?.[1]).toBeTruthy();
      const wasmPath = resolve(dirname(modulePath), match?.[1] ?? "missing");
      expect(wasmPath.startsWith(dirname(modulePath))).toBe(true);
      expect((await stat(wasmPath)).size).toBeGreaterThan(8);
      if (moduleName.endsWith("avif_enc_mt.js")) {
        const workerMatch = /new URL\(["']([^"']+\.worker\.mjs)["'],\s*import\.meta\.url\)/u.exec(
          source,
        );
        const workerPath = resolve(dirname(modulePath), workerMatch?.[1] ?? "missing");
        expect(workerPath.startsWith(dirname(modulePath))).toBe(true);
        expect((await stat(workerPath)).size).toBeGreaterThan(8);
      }
    }
  });

  it("runs image.convert through the one-request worker protocol", async () => {
    const scope = new ImageWorkerScope();
    installLocalConversionWorker(scope, dispatchImageConversion);
    const id = crypto.randomUUID();
    scope.emit({
      id,
      operation: "image.convert",
      inputFormat: "jpg",
      outputFormat: "webp",
      bytes: jpeg(1, 1),
      options: { quality: 75 },
    });
    await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
    const response = scope.posts[0] as {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly mediaType: string;
      readonly ok: boolean;
    };
    expect(response).toMatchObject({ id, mediaType: "image/webp", ok: true });
    expect(inspectImageBytes(response.bytes, "webp")).toMatchObject({ width: 1, height: 1 });
  });
});
