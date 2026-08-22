import type { FileFormat } from "@opentrad/contracts";
import { resolveCommandPolicy } from "../commandPolicy.js";
import {
  type Hardened,
  hardenWorkerValue,
  parseWorkerManifest,
  type WorkerManifest,
} from "../manifest.js";
import type { InternalProcessSpec } from "../processRunner.js";
import type { WorkerToolName } from "../toolchain.js";
import { resolveImagePolicy } from "./image.js";
import { resolveOcrImagePolicy, resolveOcrPdfPolicy } from "./ocr.js";
import { resolveOfficePolicy } from "./office.js";
import { resolveStructuredPandocPolicy } from "./pandoc.js";
import { resolvePdfRepairPolicy, resolvePdfTextToDocxPolicy } from "./pdf.js";

const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const ServerPlanError = Error;

type TargetOperation =
  | "office.to.pdf"
  | "structured.convert"
  | "ocr.pdf"
  | "ocr.image"
  | "image.convert.hq"
  | "pdf.repair"
  | "pdf.text-to-docx";

type TargetManifest = Extract<WorkerManifest, { operation: TargetOperation }>;

interface WorkspaceShape {
  readonly root: string;
  readonly sharedInput: Readonly<{ access: "read-only"; path: string }>;
  readonly stagedInput: string;
  readonly preparations: readonly Readonly<{
    kind: "copy";
    sourceAccess: "read-only";
    sourcePath: string;
    destinationPath: string;
    overwrite: false;
  }>[];
}

export interface PolicyContext {
  readonly request: TargetManifest;
  readonly workspace: Hardened<WorkspaceShape>;
}

export interface ExpectedArtifact {
  readonly format: FileFormat;
  readonly path: string;
  readonly role: "intermediate" | "result";
}

export interface PolicyResolution {
  readonly commands: readonly InternalProcessSpec[];
  readonly expectedArtifacts: readonly ExpectedArtifact[];
}

interface ServerConversionPlanShape {
  readonly schemaVersion: "server-conversion-plan-v1";
  readonly jobId: string;
  readonly operation: TargetOperation;
  readonly inputFormat: FileFormat;
  readonly outputFormat: FileFormat;
  readonly network: "none";
  readonly shell: false;
  readonly pathDiscovery: false;
  readonly deadlineMs: number;
  readonly tools: readonly WorkerToolName[];
  readonly workspace: Hardened<WorkspaceShape>;
  readonly commands: readonly InternalProcessSpec[];
  readonly expectedArtifacts: readonly Hardened<ExpectedArtifact>[];
}

export type ServerConversionPlan = Readonly<ServerConversionPlanShape>;

function fail(): never {
  throw new ServerPlanError("Unsupported server conversion plan");
}

function isTargetManifest(input: WorkerManifest): input is TargetManifest {
  switch (input.operation) {
    case "office.to.pdf":
    case "structured.convert":
    case "ocr.pdf":
    case "ocr.image":
    case "image.convert.hq":
    case "pdf.repair":
    case "pdf.text-to-docx":
      return true;
    case "spreadsheet.to.csv":
    case "bid.assemble":
      return false;
  }
}

function createWorkspace(request: TargetManifest): Hardened<WorkspaceShape> {
  const root = `/work/${request.jobId}`;
  const sharedInput = `/jobs/running/${request.jobId}/input.bin`;
  const stagedInput = `${root}/input.${request.inputFormat}`;
  return hardenWorkerValue({
    root,
    sharedInput: { access: "read-only" as const, path: sharedInput },
    stagedInput,
    preparations: [
      {
        kind: "copy" as const,
        sourceAccess: "read-only" as const,
        sourcePath: sharedInput,
        destinationPath: stagedInput,
        overwrite: false as const,
      },
    ],
  });
}

function resolvePolicy(context: PolicyContext): PolicyResolution {
  switch (context.request.operation) {
    case "office.to.pdf":
      return resolveOfficePolicy(context);
    case "structured.convert":
      return resolveStructuredPandocPolicy(context);
    case "ocr.pdf":
      return resolveOcrPdfPolicy(context);
    case "ocr.image":
      return resolveOcrImagePolicy(context);
    case "image.convert.hq":
      return resolveImagePolicy(context);
    case "pdf.repair":
      return resolvePdfRepairPolicy(context);
    case "pdf.text-to-docx":
      return resolvePdfTextToDocxPolicy(context);
  }
}

function freezeCommandSequence(
  input: readonly InternalProcessSpec[],
): readonly InternalProcessSpec[] {
  if (!intrinsicArrayIsArray(input) || intrinsicGetPrototypeOf(input) !== intrinsicArrayPrototype) {
    fail();
  }
  const keys = intrinsicReflectOwnKeys(input);
  const lengthDescriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) fail();
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !intrinsicNumberIsSafeInteger(length) ||
    length < 1 ||
    length > 8 ||
    keys.length !== length + 1
  ) {
    fail();
  }
  const output: InternalProcessSpec[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) fail();
    intrinsicDefineProperty(output, String(index), {
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return intrinsicFreeze(output);
}

function createPlan(input: unknown): ServerConversionPlan {
  const request = parseWorkerManifest(input);
  if (!isTargetManifest(request)) fail();
  const commandPolicy = resolveCommandPolicy({
    operation: request.operation,
    inputFormat: request.inputFormat,
    outputFormat: request.outputFormat,
    inputBytes: request.inputBytes,
    options: request.options,
  });
  const workspace = createWorkspace(request);
  const resolution = resolvePolicy({ request, workspace });
  const commands = freezeCommandSequence(resolution.commands);
  let timeoutTotal = 0;
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (!command) fail();
    timeoutTotal += command.timeoutMs;
  }
  if (!intrinsicNumberIsSafeInteger(timeoutTotal) || timeoutTotal > commandPolicy.timeoutMs) fail();

  const plan = intrinsicObjectCreate(null) as ServerConversionPlanShape;
  const define = (key: keyof ServerConversionPlanShape, value: unknown) => {
    intrinsicDefineProperty(plan, key, { enumerable: true, value });
  };
  define("schemaVersion", "server-conversion-plan-v1");
  define("jobId", request.jobId);
  define("operation", request.operation);
  define("inputFormat", request.inputFormat);
  define("outputFormat", request.outputFormat);
  define("network", "none");
  define("shell", false);
  define("pathDiscovery", false);
  define("deadlineMs", commandPolicy.timeoutMs);
  define("tools", hardenWorkerValue(commandPolicy.tools));
  define("workspace", workspace);
  define("commands", commands);
  define("expectedArtifacts", hardenWorkerValue(resolution.expectedArtifacts));
  return intrinsicFreeze(plan);
}

export function resolveServerConversionPlan(input: unknown): ServerConversionPlan {
  try {
    return createPlan(input);
  } catch {
    fail();
  }
}
