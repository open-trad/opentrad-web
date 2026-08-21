import { execFile as nodeExecFile } from "node:child_process";
import { isProxy } from "node:util/types";
import { hardenWorkerValue } from "./manifest.js";

const intrinsicBufferIsBuffer = Buffer.isBuffer;
const intrinsicBufferConstructor = Buffer;
const intrinsicExecFile = nodeExecFile;
const intrinsicArraySlice = Array.prototype.slice;
const intrinsicArrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferDetachedGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "detached",
)?.get;
const intrinsicArrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicHasOwn = Object.prototype.hasOwnProperty;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringTrim = String.prototype.trim;
const intrinsicTextDecoderDecode = TextDecoder.prototype.decode;
const intrinsicTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)?.get;
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const intrinsicTypedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteOffset",
)?.get;
const intrinsicUint8ArrayConstructor = Uint8Array;
const intrinsicUint8ArrayPrototype = Uint8Array.prototype;
const intrinsicUint8ArraySet = Uint8Array.prototype.set;
const ToolchainError = Error;

export const TOOLCHAIN_POLICY = hardenWorkerValue({
  network: "none" as const,
  pathDiscovery: false as const,
  shell: false as const,
  tools: {
    libreoffice: { executable: "/usr/bin/soffice", version: "26.2.5" },
    ocrmypdf: { executable: "/opt/ocr/bin/ocrmypdf", version: "17.10.0" },
    pandoc: { executable: "/usr/bin/pandoc", version: "3.10.2" },
    pdfinfo: { executable: "/usr/bin/pdfinfo", version: "26.08.0" },
    pdftoppm: { executable: "/usr/bin/pdftoppm", version: "26.08.0" },
    pdftotext: { executable: "/usr/bin/pdftotext", version: "26.08.0" },
    qpdf: { executable: "/usr/bin/qpdf", version: "12.4.0" },
    tesseract: { executable: "/usr/bin/tesseract", version: "5.5.3" },
    vips: { executable: "/usr/bin/vips", version: "8.18.5" },
  },
});

export type WorkerToolName = keyof typeof TOOLCHAIN_POLICY.tools;

const PROBE_ENVIRONMENT = {
  HOME: "/work/home",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin:/opt/ocr/bin",
  TMPDIR: "/work/tmp",
};

const probeArgv = {
  libreoffice: ["--version"],
  ocrmypdf: ["--version"],
  pandoc: ["--version"],
  pdfinfo: ["-v"],
  pdftoppm: ["-v"],
  pdftotext: ["-v"],
  qpdf: ["--version"],
  tesseract: ["--version"],
  vips: ["--version"],
} as const satisfies Record<WorkerToolName, readonly string[]>;

export const TOOLCHAIN_PROBES = hardenWorkerValue(
  (intrinsicObjectKeys(TOOLCHAIN_POLICY.tools) as WorkerToolName[]).map((tool) => ({
    argv: probeArgv[tool],
    environment: PROBE_ENVIRONMENT,
    executable: TOOLCHAIN_POLICY.tools[tool].executable,
    maxOutputBytes: 64 * 1024,
    network: "none" as const,
    shell: false as const,
    timeoutMs: 5_000,
    tool,
  })),
);

export type ToolchainProbe = (typeof TOOLCHAIN_PROBES)[number];

interface ProbeResult {
  readonly exitCode: number;
  readonly stderr: Buffer | Uint8Array;
  readonly stdout: Buffer | Uint8Array;
}

interface ProbeRuntime {
  readonly runProbe: (probe: ToolchainProbe) => Promise<unknown>;
}

const VERSION_LINE_POLICIES: Readonly<
  Record<WorkerToolName, Readonly<{ brand: RegExp; exact: RegExp }>>
> = Object.freeze({
  libreoffice: Object.freeze({
    brand: /^LibreOffice(?:Dev)?(?:\s|$)/,
    exact: /^LibreOffice(?:Dev)?\s+26\.2\.5(?:\s+.*)?$/,
  }),
  ocrmypdf: Object.freeze({
    brand: /^\d+\.\d+\.\d+(?:\.\d+)?(?:\s|$)/,
    exact: /^17\.10\.0$/,
  }),
  pandoc: Object.freeze({
    brand: /^pandoc(?:\s|[0-9])/,
    exact: /^pandoc\s+3\.10\.2$/,
  }),
  pdfinfo: Object.freeze({
    brand: /^pdfinfo\s+version(?:\s|$)/,
    exact: /^pdfinfo\s+version\s+26\.08\.0$/,
  }),
  pdftoppm: Object.freeze({
    brand: /^pdftoppm\s+version(?:\s|$)/,
    exact: /^pdftoppm\s+version\s+26\.08\.0$/,
  }),
  pdftotext: Object.freeze({
    brand: /^pdftotext\s+version(?:\s|$)/,
    exact: /^pdftotext\s+version\s+26\.08\.0$/,
  }),
  qpdf: Object.freeze({
    brand: /^qpdf\s+version(?:\s|$)/,
    exact: /^qpdf\s+version\s+12\.4\.0$/,
  }),
  tesseract: Object.freeze({
    brand: /^tesseract(?:\s|[0-9])/,
    exact: /^tesseract\s+5\.5\.3$/,
  }),
  vips: Object.freeze({
    brand: /^vips-(?:\d|$)/,
    exact: /^vips-8\.18\.5$/,
  }),
});

function invalid(): never {
  throw new ToolchainError("WORKER_TOOLCHAIN_INVALID");
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return intrinsicReflectApply(intrinsicHasOwn, value, [key]) as boolean;
}

function parseProbeRuntime(input: unknown): ProbeRuntime {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) invalid();
    const prototype = intrinsicGetPrototypeOf(input);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) invalid();
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== 1 || !hasOwn(input, "runProbe")) invalid();
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "runProbe");
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function")
      invalid();
    return { runProbe: descriptor.value as ProbeRuntime["runProbe"] };
  } catch {
    invalid();
  }
}

function copyProbeBytes(value: unknown): Uint8Array {
  try {
    if (value === null || typeof value !== "object" || isProxy(value)) invalid();
    const isBuffer = intrinsicReflectApply(intrinsicBufferIsBuffer, intrinsicBufferConstructor, [
      value,
    ]) as boolean;
    if (!isBuffer && intrinsicGetPrototypeOf(value) !== intrinsicUint8ArrayPrototype) invalid();
    if (
      !intrinsicTypedArrayBufferGetter ||
      !intrinsicTypedArrayByteLengthGetter ||
      !intrinsicTypedArrayByteOffsetGetter ||
      !intrinsicArrayBufferByteLengthGetter
    ) {
      invalid();
    }
    const buffer = intrinsicReflectApply(intrinsicTypedArrayBufferGetter, value, []);
    const byteLength = intrinsicReflectApply(
      intrinsicTypedArrayByteLengthGetter,
      value,
      [],
    ) as number;
    const byteOffset = intrinsicReflectApply(
      intrinsicTypedArrayByteOffsetGetter,
      value,
      [],
    ) as number;
    const bufferByteLength = intrinsicReflectApply(
      intrinsicArrayBufferByteLengthGetter,
      buffer,
      [],
    ) as number;
    if (
      (intrinsicArrayBufferDetachedGetter &&
        (intrinsicReflectApply(intrinsicArrayBufferDetachedGetter, buffer, []) as boolean)) ||
      (intrinsicArrayBufferResizableGetter &&
        (intrinsicReflectApply(intrinsicArrayBufferResizableGetter, buffer, []) as boolean)) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset + byteLength > bufferByteLength
    ) {
      invalid();
    }
    const copy = new intrinsicUint8ArrayConstructor(byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [value]);
    return copy;
  } catch {
    invalid();
  }
}

function copiedByteLength(value: Uint8Array): number {
  if (!intrinsicTypedArrayByteLengthGetter) invalid();
  return intrinsicReflectApply(intrinsicTypedArrayByteLengthGetter, value, []) as number;
}

/** Byte-snapshot test seam. Deliberately omitted from the package barrel. */
export function copyProbeBytesForTesting(value: unknown): Uint8Array {
  return copyProbeBytes(value);
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function decode(value: Buffer | Uint8Array): string {
  try {
    return intrinsicReflectApply(intrinsicTextDecoderDecode, decoder, [value]) as string;
  } catch {
    invalid();
  }
}

function parseProbeResult(input: unknown, maxOutputBytes: number): ProbeResult {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) invalid();
    const prototype = intrinsicGetPrototypeOf(input);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) invalid();
    const keys = intrinsicReflectOwnKeys(input);
    if (
      keys.length !== 3 ||
      !hasOwn(input, "exitCode") ||
      !hasOwn(input, "stderr") ||
      !hasOwn(input, "stdout")
    ) {
      invalid();
    }
    const values = intrinsicObjectCreate(null) as Record<"exitCode" | "stderr" | "stdout", unknown>;
    const copyData = (key: "exitCode" | "stderr" | "stdout") => {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) invalid();
      values[key] = descriptor.value;
    };
    copyData("exitCode");
    copyData("stderr");
    copyData("stdout");
    if (values.exitCode !== 0) invalid();
    const stdout = copyProbeBytes(values.stdout);
    const stderr = copyProbeBytes(values.stderr);
    const stdoutBytes = copiedByteLength(stdout);
    const stderrBytes = copiedByteLength(stderr);
    if (stdoutBytes + stderrBytes > maxOutputBytes) invalid();
    return {
      exitCode: 0,
      stderr,
      stdout,
    };
  } catch {
    invalid();
  }
}

function verifyVersionLines(tool: WorkerToolName, stdout: Uint8Array, stderr: Uint8Array): void {
  const policy = VERSION_LINE_POLICIES[tool];
  const output = `${decode(stdout)}\n${decode(stderr)}`;
  const lines = intrinsicReflectApply(intrinsicStringSplit, output, ["\n"]) as string[];
  let firstLine: string | undefined;
  let brandedLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (rawLine === undefined) invalid();
    const line = intrinsicReflectApply(intrinsicStringTrim, rawLine, []) as string;
    if (line === "") continue;
    firstLine ??= line;
    if (intrinsicReflectApply(intrinsicRegExpTest, policy.brand, [line]) as boolean) {
      brandedLines += 1;
    }
  }
  if (
    firstLine === undefined ||
    brandedLines !== 1 ||
    !(intrinsicReflectApply(intrinsicRegExpTest, policy.exact, [firstLine]) as boolean)
  ) {
    invalid();
  }
}

function createVerifier(runtimeInput: unknown) {
  const runtime = parseProbeRuntime(runtimeInput);
  return async function verify() {
    try {
      for (let index = 0; index < TOOLCHAIN_PROBES.length; index += 1) {
        const probe = TOOLCHAIN_PROBES[index];
        if (!probe) invalid();
        const raw = await intrinsicReflectApply(runtime.runProbe, undefined, [probe]);
        const result = parseProbeResult(raw, probe.maxOutputBytes);
        verifyVersionLines(probe.tool, result.stdout, result.stderr);
      }
      return hardenWorkerValue({
        schemaVersion: "worker-toolchain-v1" as const,
        network: TOOLCHAIN_POLICY.network,
        pathDiscovery: TOOLCHAIN_POLICY.pathDiscovery,
        shell: TOOLCHAIN_POLICY.shell,
        tools: TOOLCHAIN_POLICY.tools,
      });
    } catch {
      invalid();
    }
  };
}

const defaultProbeRuntime = {
  runProbe: (probe: ToolchainProbe) =>
    new Promise<ProbeResult>((resolve) => {
      intrinsicExecFile(
        probe.executable,
        intrinsicReflectApply(intrinsicArraySlice, probe.argv, []) as string[],
        {
          encoding: "buffer",
          env: probe.environment,
          maxBuffer: probe.maxOutputBytes,
          shell: false,
          timeout: probe.timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? 1 : 0,
            stderr,
            stdout,
          });
        },
      );
    }),
};

export const verifyToolchain = createVerifier(defaultProbeRuntime);

/** Fake-runtime seam for startup-policy tests. Deliberately omitted from the package barrel. */
export function createToolchainVerifierForTesting(
  runtime: unknown,
): ReturnType<typeof createVerifier> {
  return createVerifier(runtime);
}
