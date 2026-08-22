import { describe, expect, it } from "vitest";
import {
  copyProbeBytesForTesting,
  createToolchainVerifierForTesting,
  TOOLCHAIN_POLICY,
  TOOLCHAIN_PROBES,
} from "../src/toolchain.js";

const versionOutput: Record<string, string> = {
  libreoffice: "LibreOffice 26.2.5 build locked\n",
  ocrmypdf: "17.10.0\n",
  pandoc: "pandoc 3.10.2\n",
  pdfinfo: "pdfinfo version 26.08.0\n",
  pdftoppm: "pdftoppm version 26.08.0\n",
  pdftotext: "pdftotext version 26.08.0\n",
  qpdf: "qpdf version 12.4.0\n",
  tesseract: "tesseract 5.5.3\n",
  vips: "vips-8.18.5\n",
};
const pandocVersionOutput = versionOutput.pandoc ?? "";

function expectHardened(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    for (const entry of value) expectHardened(entry);
    return;
  }
  expect(Object.getPrototypeOf(value)).toBeNull();
  for (const entry of Object.values(value)) expectHardened(entry);
}

function validRuntime(overrides: Record<string, string> = {}) {
  let active = 0;
  let maximumActive = 0;
  const calls: unknown[] = [];
  return {
    calls,
    maximumActive: () => maximumActive,
    runtime: {
      runProbe: async (probe: { tool: string }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls.push(probe);
        await Promise.resolve();
        active -= 1;
        return {
          exitCode: 0,
          stderr: Buffer.alloc(0),
          stdout: Buffer.from(overrides[probe.tool] ?? versionOutput[probe.tool] ?? ""),
        };
      },
    },
  };
}

describe("worker toolchain startup verification", () => {
  it("probes every fixed absolute executable serially and returns exact frozen parity", async () => {
    const fake = validRuntime();
    const manifest = await createToolchainVerifierForTesting(fake.runtime)();

    expect(fake.calls).toEqual(TOOLCHAIN_PROBES);
    expect(fake.maximumActive()).toBe(1);
    expect(manifest).toEqual({
      schemaVersion: "worker-toolchain-v1",
      network: "none",
      pathDiscovery: false,
      shell: false,
      tools: TOOLCHAIN_POLICY.tools,
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expectHardened(manifest);
  });

  it("defines bounded no-shell probes with a fixed secret-free environment", () => {
    expect(TOOLCHAIN_PROBES).toHaveLength(Object.keys(TOOLCHAIN_POLICY.tools).length);
    expect(TOOLCHAIN_PROBES.map(({ tool }) => tool)).toEqual(Object.keys(TOOLCHAIN_POLICY.tools));
    for (const probe of TOOLCHAIN_PROBES) {
      expect(probe.executable).toBe(TOOLCHAIN_POLICY.tools[probe.tool].executable);
      expect(probe.executable.startsWith("/")).toBe(true);
      expect(probe.shell).toBe(false);
      expect(probe.network).toBe("none");
      expect(probe.timeoutMs).toBe(5_000);
      expect(probe.maxOutputBytes).toBe(64 * 1024);
      expect(probe.environment).toEqual({
        HOME: "/work/home",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin:/opt/ocr/bin",
        TMPDIR: "/work/tmp",
      });
      expect(JSON.stringify(probe)).not.toMatch(/secret|token|password/i);
    }
  });

  it("uses the exact fixed probe argv for each tool", () => {
    expect(Object.fromEntries(TOOLCHAIN_PROBES.map(({ tool, argv }) => [tool, argv]))).toEqual({
      libreoffice: ["--version"],
      ocrmypdf: ["--version"],
      pandoc: ["--version"],
      pdfinfo: ["-v"],
      pdftoppm: ["-v"],
      pdftotext: ["-v"],
      qpdf: ["--version"],
      tesseract: ["--version"],
      vips: ["--version"],
    });
  });

  it.each([
    ["version mismatch", { pandoc: "pandoc 3.10.20\n" }],
    ["missing version", { pandoc: "pandoc unknown\n" }],
  ])("fails closed with one fixed error for %s", async (_label, overrides) => {
    const fake = validRuntime(overrides);
    await expect(createToolchainVerifierForTesting(fake.runtime)()).rejects.toThrow(
      /^WORKER_TOOLCHAIN_INVALID$/,
    );
  });

  it("rejects a second branded version line even when the first line matches", async () => {
    for (const [tool, secondLine] of Object.entries({
      libreoffice: "LibreOffice 99.9.9",
      ocrmypdf: "99.9.9",
      pandoc: "pandoc 9.9.9",
      pdfinfo: "pdfinfo version 99.9.9",
      pdftoppm: "pdftoppm version 99.9.9",
      pdftotext: "pdftotext version 99.9.9",
      qpdf: "qpdf version 99.9.9",
      tesseract: "tesseract 9.9.9",
      vips: "vips-9.9.9",
    })) {
      const fake = validRuntime({
        [tool]: `${versionOutput[tool]}${secondLine}\n`,
      });
      await expect(createToolchainVerifierForTesting(fake.runtime)(), tool).rejects.toThrow(
        /^WORKER_TOOLCHAIN_INVALID$/,
      );
    }
  });

  it("allows normal non-version detail lines after pandoc and tesseract", async () => {
    const fake = validRuntime({
      pandoc: "pandoc 3.10.2\nFeatures: +server +lua\nDefault user data directory: /work/home\n",
      tesseract: "tesseract 5.5.3\n leptonica-1.85.0\n  libjpeg 9f\n",
    });
    await expect(createToolchainVerifierForTesting(fake.runtime)()).resolves.toBeDefined();
  });

  it("rejects failed probes, oversized output, extra result fields, and non-byte output", async () => {
    const cases = [
      { exitCode: 2, stderr: Buffer.from("/private/file"), stdout: Buffer.alloc(0) },
      { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.alloc(64 * 1024 + 1) },
      { exitCode: 0, extra: true, stderr: Buffer.alloc(0), stdout: Buffer.from("3.10.2") },
      { exitCode: 0, stderr: Buffer.alloc(0), stdout: { byteLength: 1 } },
    ];
    for (const result of cases) {
      const verify = createToolchainVerifierForTesting({ runProbe: async () => result });
      await expect(verify()).rejects.toThrow(/^WORKER_TOOLCHAIN_INVALID$/);
    }
  });

  it("rejects hostile runtimes and results without invoking accessors", async () => {
    let getterCalls = 0;
    const accessorRuntime = {};
    Object.defineProperty(accessorRuntime, "runProbe", {
      get() {
        getterCalls += 1;
        return async () => ({});
      },
    });
    expect(() => createToolchainVerifierForTesting(accessorRuntime)).toThrow(
      "WORKER_TOOLCHAIN_INVALID",
    );
    expect(() =>
      createToolchainVerifierForTesting(new Proxy({ runProbe: async () => ({}) }, {})),
    ).toThrow("WORKER_TOOLCHAIN_INVALID");

    const result = {};
    Object.defineProperty(result, "stdout", {
      get() {
        getterCalls += 1;
        return Buffer.alloc(0);
      },
    });
    Object.defineProperty(result, "stderr", { value: Buffer.alloc(0), enumerable: true });
    Object.defineProperty(result, "exitCode", { value: 0, enumerable: true });
    const verify = createToolchainVerifierForTesting({ runProbe: async () => result });
    await expect(verify()).rejects.toThrow(/^WORKER_TOOLCHAIN_INVALID$/);
    expect(getterCalls).toBe(0);
  });

  it("copies genuine bytes synchronously without reading own shadow accessors", () => {
    const source = new Uint8Array(Buffer.from("pandoc 3.10.2\n"));
    let getterCalls = 0;
    for (const key of ["buffer", "byteLength", "byteOffset"] as const) {
      Object.defineProperty(source, key, {
        configurable: true,
        get() {
          getterCalls += 1;
          throw new Error("shadow getter");
        },
      });
    }
    const originalSet = Uint8Array.prototype.set;
    let copy: Uint8Array | undefined;
    try {
      Uint8Array.prototype.set = () => {
        throw new Error("poisoned set");
      };
      copy = copyProbeBytesForTesting(source);
    } finally {
      Uint8Array.prototype.set = originalSet;
    }
    source[0] = 0;
    expect(Buffer.from(copy ?? []).toString("utf8")).toBe("pandoc 3.10.2\n");
    expect(getterCalls).toBe(0);
  });

  it("rejects SharedArrayBuffer and detached backing buffers but accepts legitimate empty bytes", async () => {
    const shared = new Uint8Array(new SharedArrayBuffer(Buffer.byteLength(pandocVersionOutput)));
    shared.set(Buffer.from(pandocVersionOutput));
    await expect(
      createToolchainVerifierForTesting({
        runProbe: async (probe: { tool: string }) => ({
          exitCode: 0,
          stderr: Buffer.alloc(0),
          stdout: probe.tool === "pandoc" ? shared : Buffer.from(versionOutput[probe.tool] ?? ""),
        }),
      })(),
    ).rejects.toThrow(/^WORKER_TOOLCHAIN_INVALID$/);

    const backing = new ArrayBuffer(8);
    const detached = new Uint8Array(backing);
    structuredClone(backing, { transfer: [backing] });
    const detachedVerify = createToolchainVerifierForTesting({
      runProbe: async (probe: { tool: string }) => ({
        exitCode: 0,
        stderr: probe.tool === "pandoc" ? detached : Buffer.alloc(0),
        stdout: Buffer.from(versionOutput[probe.tool] ?? ""),
      }),
    });
    await expect(detachedVerify()).rejects.toThrow(/^WORKER_TOOLCHAIN_INVALID$/);

    expect(copyProbeBytesForTesting(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it.runIf(
    typeof Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get === "function",
  )("rejects a resizable ArrayBuffer view", async () => {
    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      length: number,
      options: { maxByteLength: number },
    ) => ArrayBuffer;
    const backing = new ResizableArrayBuffer(Buffer.byteLength(pandocVersionOutput), {
      maxByteLength: 1024,
    });
    const view = new Uint8Array(backing);
    view.set(Buffer.from(pandocVersionOutput));
    const verify = createToolchainVerifierForTesting({
      runProbe: async (probe: { tool: string }) => ({
        exitCode: 0,
        stderr: Buffer.alloc(0),
        stdout: probe.tool === "pandoc" ? view : Buffer.from(versionOutput[probe.tool] ?? ""),
      }),
    });
    await expect(verify()).rejects.toThrow(/^WORKER_TOOLCHAIN_INVALID$/);
  });

  it("does not consult mutable Array or RegExp prototype methods while verifying", async () => {
    const fake = validRuntime();
    const originalEvery = Array.prototype.every;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalTest = RegExp.prototype.test;
    let verifier: ReturnType<typeof createToolchainVerifierForTesting> | undefined;
    let pending: ReturnType<NonNullable<typeof verifier>> | undefined;
    try {
      Array.prototype.every = (() => {
        throw new Error("poisoned every");
      }) as unknown as typeof Array.prototype.every;
      Array.prototype[Symbol.iterator] = () => {
        throw new Error("poisoned iterator");
      };
      RegExp.prototype.test = () => {
        throw new Error("poisoned test");
      };
      verifier = createToolchainVerifierForTesting(fake.runtime);
      pending = verifier();
    } finally {
      Array.prototype.every = originalEvery;
      Array.prototype[Symbol.iterator] = originalIterator;
      RegExp.prototype.test = originalTest;
    }
    await expect(pending).resolves.toBeDefined();
  });
});
