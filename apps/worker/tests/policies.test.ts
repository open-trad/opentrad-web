import { EventEmitter } from "node:events";
import {
  CAPABILITIES,
  type ConversionCapability,
  type CreateJobRequest,
} from "@opentrad/contracts";
import { describe, expect, it } from "vitest";
import { resolveCommandPolicy } from "../src/commandPolicy.js";
import * as workerExports from "../src/index.js";
import { resolveServerConversionPlan } from "../src/policies/workspace.js";
import { createProcessRunnerForTesting, FIXED_PROCESS_ENVIRONMENT } from "../src/processRunner.js";
import { TOOLCHAIN_POLICY, type WorkerToolName } from "../src/toolchain.js";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const WORK_ROOT = `/work/${JOB_ID}`;
const SHARED_INPUT = `/jobs/running/${JOB_ID}/input.bin`;
const TARGET_OPERATIONS = Object.freeze([
  "office.to.pdf",
  "structured.convert",
  "ocr.pdf",
  "ocr.image",
  "image.convert.hq",
  "pdf.repair",
  "pdf.text-to-docx",
] as const);

type TargetOperation = (typeof TARGET_OPERATIONS)[number];

function targetCapabilities(): ConversionCapability[] {
  return CAPABILITIES.filter((capability) =>
    (TARGET_OPERATIONS as readonly string[]).includes(capability.id),
  );
}

function defaultOptions(operation: string): Record<string, unknown> {
  return operation === "ocr.pdf" || operation === "ocr.image" ? {} : {};
}

function manifest(
  operation: TargetOperation,
  inputFormat: string,
  outputFormat: string,
  options: Record<string, unknown> = defaultOptions(operation),
): Record<string, unknown> {
  return {
    schemaVersion: "server-v1",
    jobId: JOB_ID,
    operation,
    inputFormat,
    outputFormat,
    inputBytes: 1,
    options,
  };
}

function requestForPolicy(input: Record<string, unknown>): CreateJobRequest {
  return {
    operation: input.operation,
    inputFormat: input.inputFormat,
    outputFormat: input.outputFormat,
    inputBytes: input.inputBytes,
    options: input.options,
  } as CreateJobRequest;
}

function expectHardened(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value)).toBe(Array.prototype);
    for (const entry of value) expectHardened(entry);
    return;
  }
  expect(Object.getPrototypeOf(value)).toBeNull();
  for (const entry of Object.values(value)) expectHardened(entry);
}

function commandSnapshot(plan: ReturnType<typeof resolveServerConversionPlan>) {
  return plan.commands.map((command) => ({
    executable: command.executable,
    argv: command.argv,
    timeoutMs: command.timeoutMs,
    shell: command.shell,
    environment: command.environment,
  }));
}

function toolForExecutable(executable: string): WorkerToolName | undefined {
  for (const [name, policy] of Object.entries(TOOLCHAIN_POLICY.tools)) {
    if (policy.executable === executable) return name as WorkerToolName;
  }
  return undefined;
}

describe("fixed non-bid server conversion plans", () => {
  it("covers exactly the 7 target operations and all 61 authoritative contract pairs", () => {
    const capabilities = targetCapabilities();
    expect(capabilities.map(({ id }) => id)).toEqual(TARGET_OPERATIONS);

    let pairs = 0;
    for (const capability of capabilities) {
      for (const inputFormat of capability.inputFormats) {
        for (const outputFormat of capability.outputFormats) {
          const input = manifest(capability.id as TargetOperation, inputFormat, outputFormat);
          const plan = resolveServerConversionPlan(input);
          const commandPolicy = resolveCommandPolicy(requestForPolicy(input));
          const commandTools = plan.commands.map(({ executable }) => toolForExecutable(executable));
          const commandTimeout = plan.commands.reduce(
            (total, command) => total + command.timeoutMs,
            0,
          );

          expect(plan.operation).toBe(capability.id);
          expect(plan.inputFormat).toBe(inputFormat);
          expect(plan.outputFormat).toBe(outputFormat);
          expect(plan.workspace).toEqual({
            root: WORK_ROOT,
            sharedInput: { access: "read-only", path: SHARED_INPUT },
            stagedInput: `${WORK_ROOT}/input.${inputFormat}`,
            preparations: [
              {
                kind: "copy",
                sourceAccess: "read-only",
                sourcePath: SHARED_INPUT,
                destinationPath: `${WORK_ROOT}/input.${inputFormat}`,
                overwrite: false,
              },
            ],
          });
          expect(plan.tools).toEqual(commandPolicy.tools);
          expect(commandTools).toEqual(commandPolicy.tools);
          expect(plan.deadlineMs).toBe(commandPolicy.timeoutMs);
          expect(commandTimeout).toBeLessThanOrEqual(plan.deadlineMs);
          expect(plan.commands.length).toBeGreaterThan(0);
          expect(Object.keys(plan.commands)).toEqual(
            Array.from({ length: plan.commands.length }, (_entry, index) => String(index)),
          );

          const commandJson = JSON.stringify(plan.commands);
          expect(commandJson).not.toContain("/jobs/");
          expect(commandJson).not.toMatch(/https?:|file:\/\/(?!\/work\/)/u);
          for (const command of plan.commands) {
            expect(command.shell).toBe(false);
            expect(command.executable.startsWith("/")).toBe(true);
            for (const argument of command.argv) {
              if (argument.startsWith("/work/"))
                expect(argument.startsWith(`${WORK_ROOT}/`)).toBe(true);
              if (argument.startsWith("file:///work/")) {
                expect(argument.startsWith(`file://${WORK_ROOT}/`)).toBe(true);
              }
            }
          }
          pairs += 1;
        }
      }
    }
    expect(pairs).toBe(61);
  });

  it("uses the exact fixed LibreOffice and Pandoc argv", () => {
    expect(
      commandSnapshot(resolveServerConversionPlan(manifest("office.to.pdf", "docx", "pdf"))),
    ).toEqual([
      {
        executable: "/usr/bin/soffice",
        argv: [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--nofirststartwizard",
          `-env:UserInstallation=file://${WORK_ROOT}/libreoffice-profile`,
          "--convert-to",
          "pdf",
          "--outdir",
          `${WORK_ROOT}/office-output`,
          `${WORK_ROOT}/input.docx`,
        ],
        timeoutMs: 120_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.libreoffice,
      },
    ]);

    expect(
      commandSnapshot(resolveServerConversionPlan(manifest("structured.convert", "md", "html"))),
    ).toEqual([
      {
        executable: "/usr/bin/pandoc",
        argv: [
          "--sandbox",
          "--from",
          "gfm",
          "--to",
          "html5",
          "--output",
          `${WORK_ROOT}/result.html`,
          `${WORK_ROOT}/input.md`,
        ],
        timeoutMs: 90_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
    ]);
  });

  it("uses the exact fixed OCR PDF and OCR image pipelines", () => {
    expect(
      commandSnapshot(
        resolveServerConversionPlan(manifest("ocr.pdf", "pdf", "txt", { language: "chi_sim+eng" })),
      ),
    ).toEqual([
      {
        executable: "/opt/ocr/bin/ocrmypdf",
        argv: [
          "--rasterizer",
          "pypdfium",
          "--output-type",
          "pdf",
          "--optimize",
          "0",
          "--jobs",
          "1",
          "--tesseract-timeout",
          "120",
          "--language",
          "chi_sim+eng",
          `${WORK_ROOT}/input.pdf`,
          `${WORK_ROOT}/ocr.pdf`,
        ],
        timeoutMs: 300_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.ocr,
      },
      {
        executable: "/usr/bin/pdftotext",
        argv: ["-enc", "UTF-8", "-nopgbrk", `${WORK_ROOT}/ocr.pdf`, `${WORK_ROOT}/result.txt`],
        timeoutMs: 30_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
    ]);

    expect(
      commandSnapshot(
        resolveServerConversionPlan(manifest("ocr.image", "webp", "pdf", { language: "eng" })),
      ),
    ).toEqual([
      {
        executable: "/usr/bin/tesseract",
        argv: [`${WORK_ROOT}/input.webp`, `${WORK_ROOT}/ocr-image`, "-l", "eng", "pdf"],
        timeoutMs: 90_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.ocr,
      },
      {
        executable: "/usr/bin/qpdf",
        argv: [
          "--warning-exit-0",
          "--object-streams=generate",
          `${WORK_ROOT}/ocr-image.pdf`,
          `${WORK_ROOT}/result.pdf`,
        ],
        timeoutMs: 30_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
    ]);
  });

  it("uses the exact fixed image, qpdf repair, and PDF text-to-DOCX pipelines", () => {
    expect(
      commandSnapshot(resolveServerConversionPlan(manifest("image.convert.hq", "avif", "jpg"))),
    ).toEqual([
      {
        executable: "/usr/bin/vips",
        argv: ["copy", `${WORK_ROOT}/input.avif`, `${WORK_ROOT}/result.jpg`, "--strip"],
        timeoutMs: 60_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.image,
      },
    ]);

    expect(
      commandSnapshot(resolveServerConversionPlan(manifest("pdf.repair", "pdf", "pdf"))),
    ).toEqual([
      {
        executable: "/usr/bin/qpdf",
        argv: [
          "--warning-exit-0",
          "--object-streams=generate",
          `${WORK_ROOT}/input.pdf`,
          `${WORK_ROOT}/result.pdf`,
        ],
        timeoutMs: 90_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
    ]);

    expect(
      commandSnapshot(resolveServerConversionPlan(manifest("pdf.text-to-docx", "pdf", "docx"))),
    ).toEqual([
      {
        executable: "/usr/bin/pdftotext",
        argv: ["-enc", "UTF-8", "-nopgbrk", `${WORK_ROOT}/input.pdf`, `${WORK_ROOT}/extracted.txt`],
        timeoutMs: 30_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
      {
        executable: "/usr/bin/pandoc",
        argv: [
          "--sandbox",
          "--from",
          "plain",
          "--to",
          "docx",
          "--output",
          `${WORK_ROOT}/result.docx`,
          `${WORK_ROOT}/extracted.txt`,
        ],
        timeoutMs: 90_000,
        shell: false,
        environment: FIXED_PROCESS_ENVIRONMENT.base,
      },
    ]);
  });

  it("budgets multi-page OCRmyPDF without a 150s/180s premature worker timeout", () => {
    const capability = CAPABILITIES.find(({ id }) => id === "ocr.pdf");
    const pdf = resolveServerConversionPlan(manifest("ocr.pdf", "pdf", "pdf"));
    const text = resolveServerConversionPlan(manifest("ocr.pdf", "pdf", "txt"));
    const commandTimeouts = (plan: ReturnType<typeof resolveServerConversionPlan>) =>
      plan.commands.map(({ timeoutMs }) => timeoutMs);
    const totalTimeout = (plan: ReturnType<typeof resolveServerConversionPlan>) =>
      plan.commands.reduce((total, command) => total + command.timeoutMs, 0);

    expect(capability?.limits.maxPages).toBe(20);
    expect(pdf.commands[0]?.argv).toContain("120");
    expect(text.commands[0]?.argv).toContain("120");
    expect(commandTimeouts(pdf)).toEqual([300_000]);
    expect(pdf.deadlineMs).toBe(300_000);
    expect(totalTimeout(pdf)).toBe(300_000);
    expect(commandTimeouts(text)).toEqual([300_000, 30_000]);
    expect(text.deadlineMs).toBe(330_000);
    expect(totalTimeout(text)).toBe(330_000);
    expect(pdf.deadlineMs).toBeLessThan(15 * 60_000);
    expect(text.deadlineMs).toBeLessThan(15 * 60_000);

    expect({
      "image.convert.hq": resolveServerConversionPlan(manifest("image.convert.hq", "png", "jpg"))
        .deadlineMs,
      "ocr.image": resolveServerConversionPlan(manifest("ocr.image", "png", "pdf")).deadlineMs,
      "office.to.pdf": resolveServerConversionPlan(manifest("office.to.pdf", "docx", "pdf"))
        .deadlineMs,
      "pdf.repair": resolveServerConversionPlan(manifest("pdf.repair", "pdf", "pdf")).deadlineMs,
      "pdf.text-to-docx": resolveServerConversionPlan(manifest("pdf.text-to-docx", "pdf", "docx"))
        .deadlineMs,
      "structured.convert": resolveServerConversionPlan(
        manifest("structured.convert", "docx", "md"),
      ).deadlineMs,
    }).toEqual({
      "image.convert.hq": 60_000,
      "ocr.image": 120_000,
      "office.to.pdf": 120_000,
      "pdf.repair": 90_000,
      "pdf.text-to-docx": 120_000,
      "structured.convert": 90_000,
    });
  });

  it("publishes exact expected artifacts for every single- and multi-command plan", () => {
    expect(
      resolveServerConversionPlan(manifest("office.to.pdf", "xlsx", "pdf")).expectedArtifacts,
    ).toEqual([{ format: "pdf", path: `${WORK_ROOT}/office-output/input.pdf`, role: "result" }]);
    expect(
      resolveServerConversionPlan(manifest("ocr.pdf", "pdf", "txt")).expectedArtifacts,
    ).toEqual([
      { format: "pdf", path: `${WORK_ROOT}/ocr.pdf`, role: "intermediate" },
      { format: "txt", path: `${WORK_ROOT}/result.txt`, role: "result" },
    ]);
    expect(
      resolveServerConversionPlan(manifest("ocr.image", "png", "pdf")).expectedArtifacts,
    ).toEqual([
      { format: "pdf", path: `${WORK_ROOT}/ocr-image.pdf`, role: "intermediate" },
      { format: "pdf", path: `${WORK_ROOT}/result.pdf`, role: "result" },
    ]);
    expect(
      resolveServerConversionPlan(manifest("pdf.text-to-docx", "pdf", "docx")).expectedArtifacts,
    ).toEqual([
      { format: "txt", path: `${WORK_ROOT}/extracted.txt`, role: "intermediate" },
      { format: "docx", path: `${WORK_ROOT}/result.docx`, role: "result" },
    ]);
  });

  it("returns branded process specs accepted by the runner while exporting no runner seam", async () => {
    const plan = resolveServerConversionPlan(manifest("pdf.text-to-docx", "pdf", "docx"));
    const spawned: string[] = [];
    const run = createProcessRunnerForTesting({
      spawn: (executable: string) => {
        const child = new EventEmitter() as EventEmitter & {
          pid: number;
          stderr: EventEmitter;
        };
        child.pid = 4_321 + spawned.length;
        child.stderr = new EventEmitter();
        spawned.push(executable);
        queueMicrotask(() => child.emit("close", 0, null));
        return child;
      },
      kill: () => true,
      killChild: () => true,
      setTimer: (callback: () => void, delay: number) => setTimeout(callback, delay),
      clearTimer: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });

    for (const command of plan.commands) {
      await expect(run(command, new AbortController().signal)).resolves.toBeUndefined();
    }
    expect(spawned).toEqual(["/usr/bin/pdftotext", "/usr/bin/pandoc"]);
    expect(workerExports).toHaveProperty("resolveServerConversionPlan");
    expect(workerExports).not.toHaveProperty("createInternalProcessSpec");
    expect(workerExports).not.toHaveProperty("runCommand");
    expect(workerExports).not.toHaveProperty("resolveWorkspacePaths");
    expect(workerExports).not.toHaveProperty("officeToPdf");
    expect(workerExports).not.toHaveProperty("pandocConvert");
  });

  it("is null-prototype, deeply frozen, deterministic, and JSON serializable without private metadata", () => {
    const input = manifest("ocr.pdf", "pdf", "txt", { language: "eng" });
    const first = resolveServerConversionPlan(input);
    const second = resolveServerConversionPlan(input);
    const json = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(JSON.parse(json)).toEqual(first);
    expectHardened(first);
    expect(json).not.toMatch(/inputBytes|sourceName|originalName|displayName|body|hash|log/iu);
    expect(json).not.toMatch(/secret|token|password/iu);
  });

  it("never accepts or copies caller command, argv, environment, path, or Pandoc extension fields", () => {
    const injections = [
      "curl https://example.invalid/private",
      "--lua-filter=/work/evil.lua",
      "--resource-path=/jobs/private",
      "--embed-resources",
      "/tmp/customer-name.docx",
      "SECRET_DO_NOT_COPY",
    ];
    const base = manifest("structured.convert", "docx", "md");
    const threats: unknown[] = [
      { ...base, command: injections[0] },
      { ...base, argv: [injections[1]] },
      { ...base, environment: { API_SECRET: injections[5] } },
      { ...base, path: injections[4] },
      { ...base, sourceName: injections[4] },
      { ...base, body: injections[5] },
      { ...base, hash: injections[5] },
      { ...base, options: { writer: injections[1] } },
      { ...base, options: { resourcePath: injections[2] } },
      { ...base, options: { embedResources: injections[3] } },
      manifest("ocr.pdf", "pdf", "txt", { language: `eng; ${injections[0]}` }),
    ];
    for (const threat of threats) {
      expect(() => resolveServerConversionPlan(threat)).toThrow(
        "Unsupported server conversion plan",
      );
    }

    const json = JSON.stringify(resolveServerConversionPlan(base));
    for (const injection of injections) expect(json).not.toContain(injection);
  });

  it("rejects format mismatches, unknown/local-first/spreadsheet/bid operations, and invalid UUID paths", () => {
    const invalid: unknown[] = [
      manifest("office.to.pdf", "docx", "docx"),
      manifest("structured.convert", "pdf", "md"),
      manifest("ocr.image", "avif", "txt"),
      { ...manifest("pdf.repair", "pdf", "pdf"), operation: "unknown.server" },
      { ...manifest("pdf.repair", "pdf", "pdf"), operation: "pdf.organize" },
      {
        ...manifest("pdf.repair", "pdf", "pdf"),
        operation: "spreadsheet.to.csv",
        inputFormat: "xlsx",
        outputFormat: "csv",
        options: {},
      },
      {
        ...manifest("pdf.repair", "pdf", "pdf"),
        operation: "bid.assemble",
        inputFormat: "opentrad",
        outputFormat: "pdf",
        options: { templateId: "bid.government.goods.v1", templateVersion: "1.0.0" },
      },
      { ...manifest("pdf.repair", "pdf", "pdf"), jobId: "../running/escape" },
      { ...manifest("pdf.repair", "pdf", "pdf"), jobId: `${JOB_ID}/escape` },
    ];
    for (const input of invalid) {
      expect(() => resolveServerConversionPlan(input)).toThrow(
        "Unsupported server conversion plan",
      );
    }
  });

  it("fails closed on proxies, accessors, hostile prototypes, and inherited prototype pollution", () => {
    const valid = manifest("pdf.repair", "pdf", "pdf");
    let reads = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, "operation", {
      enumerable: true,
      get() {
        reads += 1;
        return "pdf.repair";
      },
    });
    const polluted = Object.assign(Object.create({ path: "/tmp/inherited" }), valid);

    expect(() => resolveServerConversionPlan(new Proxy(valid, {}))).toThrow(
      "Unsupported server conversion plan",
    );
    expect(() => resolveServerConversionPlan({ ...valid, options: new Proxy({}, {}) })).toThrow(
      "Unsupported server conversion plan",
    );
    expect(() => resolveServerConversionPlan(accessor)).toThrow(
      "Unsupported server conversion plan",
    );
    expect(() => resolveServerConversionPlan(polluted)).toThrow(
      "Unsupported server conversion plan",
    );
    expect(reads).toBe(0);

    Object.defineProperty(Object.prototype, "sourceName", {
      configurable: true,
      value: "INHERITED_SECRET_NAME",
    });
    try {
      expect(JSON.stringify(resolveServerConversionPlan(valid))).not.toContain(
        "INHERITED_SECRET_NAME",
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, "sourceName");
    }
  });

  it("defaults OCR deterministically and accepts only the three contract languages", () => {
    for (const operation of ["ocr.pdf", "ocr.image"] as const) {
      const inputFormat = operation === "ocr.pdf" ? "pdf" : "png";
      const outputFormat = operation === "ocr.pdf" ? "pdf" : "txt";
      expect(
        JSON.stringify(resolveServerConversionPlan(manifest(operation, inputFormat, outputFormat))),
      ).toContain("chi_sim+eng");
      for (const language of ["chi_sim", "eng", "chi_sim+eng"]) {
        expect(() =>
          resolveServerConversionPlan(manifest(operation, inputFormat, outputFormat, { language })),
        ).not.toThrow();
      }
      for (const language of ["deu", "eng+chi_sim", "eng --psm 0", ""]) {
        expect(() =>
          resolveServerConversionPlan(manifest(operation, inputFormat, outputFormat, { language })),
        ).toThrow("Unsupported server conversion plan");
      }
    }
  });
});
