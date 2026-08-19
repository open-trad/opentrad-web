# OpenTrad Conversion, Authentication, and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete local conversion center, username/GitHub authentication, privacy-preserving conversion API, and sandboxed server worker while preserving OpenTrad's anonymous local-first behavior.

**Architecture:** Keep browser-only conversion code, shared API contracts, the Fastify API, and the no-network conversion worker in separate workspace packages so server-native dependencies cannot enter the Pages bundle. The API owns authentication, quotas, ClamAV admission, and task metadata; the worker consumes only allowlisted manifests from an ephemeral shared queue and never receives a Docker socket or network. Local preview, DOCX, PDF, image, and text conversion remain anonymous and never upload data.

**Tech Stack:** Node.js 24.19.0, pnpm 10.28.2, React 19, TypeScript 5.9, Vite 7, Zod 4.4.3, PDF.js 6.2.108, pdf-lib 1.17.1, Mammoth 1.12.1, jSquash AVIF 2.1.1, Fastify 5.12.1, Better Auth 1.7.1, better-sqlite3 13.0.3, Vitest, Playwright, ClamAV 1.5.4, LibreOffice 26.2.5, Pandoc 3.10.2, OCRmyPDF 17.10.0, Tesseract 5.5.3, qpdf 12.4.0, Poppler 26.08.0, and libvips 8.18.5.

---

## Locked boundaries

- Anonymous users retain all template editing, local drafts, local conversion, and local document export.
- Only server conversion, OCR, and full bid attachment assembly require authentication and explicit upload consent.
- No AI, analytics, paid conversion API, cloud document storage, third-party font CDN, or runtime JavaScript CDN is introduced.
- No file is uploaded until the user checks the server-processing consent control for that exact submission.
- SQLite, logs, backups, and status manifests never contain source filenames, document text, or content hashes.
- The worker has no network, no Docker socket, a read-only root filesystem, fixed resources, and only explicit command policies.
- GitHub Pages remains a static preview. It must never silently call the production API.
- PDF text extraction to Word is always capability grade C and is labeled experimental.
- Implementation stops before host/DNS/TLS mutation; production mechanics are covered by the companion production-release plan.

## Primary sources and version locks

- Better Auth 1.7.1: https://github.com/better-auth/better-auth/releases/tag/v1.7.1
- Better Auth Fastify: https://better-auth.com/docs/integrations/fastify
- Better Auth security: https://better-auth.com/docs/reference/security
- Better Auth username: https://better-auth.com/docs/plugins/username
- Better Auth GitHub provider: https://better-auth.com/docs/authentication/github
- PDF.js 6.2.108: https://github.com/mozilla/pdf.js/releases/tag/v6.2.108
- PDF.js CVE-2026-16633: https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j
- Mammoth security warning: https://github.com/mwilliamson/mammoth.js/#security
- Docker seccomp: https://docs.docker.com/engine/security/seccomp/
- OCRmyPDF 17.10.0: https://github.com/ocrmypdf/OCRmyPDF/releases/tag/v17.10.0
- OCRmyPDF pypdfium path: https://ocrmypdf.readthedocs.io/en/latest/cookbook.html
- Pandoc sandbox: https://pandoc.org/MANUAL.html#option--sandbox

## File map

### Shared contracts

- Create: \`packages/contracts/package.json\` — workspace metadata and exports.
- Create: \`packages/contracts/tsconfig.json\` — package typecheck settings.
- Create: \`packages/contracts/tsconfig.build.json\` — declaration/build output.
- Create: \`packages/contracts/src/conversion.ts\` — operations, formats, capability grades, and limits.
- Create: \`packages/contracts/src/jobs.ts\` — job requests, states, status responses, and stable error codes.
- Create: \`packages/contracts/src/api.ts\` — response envelopes and registration contracts.
- Create: \`packages/contracts/src/index.ts\` — public exports.
- Create: \`packages/contracts/tests/conversion.test.ts\` — capability completeness and grade tests.
- Create: \`packages/contracts/tests/jobs.test.ts\` — strict schema and privacy-field rejection tests.

### Browser-local conversion

- Create: \`packages/conversion-local/package.json\`.
- Create: \`packages/conversion-local/tsconfig.json\`.
- Create: \`packages/conversion-local/src/protocol.ts\` — worker request and response messages.
- Create: \`packages/conversion-local/src/client.ts\` — browser worker client, timeout, and cancellation.
- Create: \`packages/conversion-local/src/worker.ts\` — operation dispatcher.
- Create: \`packages/conversion-local/src/limits.ts\` — browser byte/page/pixel limits.
- Create: \`packages/conversion-local/src/text/semanticDocument.ts\` — safe semantic AST.
- Create: \`packages/conversion-local/src/text/convertText.ts\`.
- Create: \`packages/conversion-local/src/docx/convertDocx.ts\`.
- Create: \`packages/conversion-local/src/image/convertImage.ts\`.
- Create: \`packages/conversion-local/src/pdf/pdfjs.ts\`.
- Create: \`packages/conversion-local/src/pdf/transformPdf.ts\`.
- Create: \`packages/conversion-local/src/index.ts\`.
- Create: \`packages/conversion-local/tests/protocol.test.ts\`.
- Create: \`packages/conversion-local/tests/text.test.ts\`.
- Create: \`packages/conversion-local/tests/docx-security.test.ts\`.
- Create: \`packages/conversion-local/tests/image.test.ts\`.
- Create: \`packages/conversion-local/tests/pdf-security.test.ts\`.
- Create: \`packages/conversion-local/tests/pdf-transform.test.ts\`.

### API and authentication

- Create: \`apps/api/package.json\`.
- Create: \`apps/api/tsconfig.json\`.
- Create: \`apps/api/src/config.ts\` — validated environment without secret logging.
- Create: \`apps/api/src/db/openDatabase.ts\` — WAL SQLite setup.
- Create: \`apps/api/src/db/migrations/001_auth.sql\` — reviewed Better Auth 1.7.1 schema.
- Create: \`apps/api/src/db/migrations/002_jobs.sql\` — metadata, quota, and idempotency schema.
- Create: \`apps/api/src/db/migrate.ts\` — apply and dry-run migrations.
- Create: \`apps/api/src/auth/auth.ts\` — Better Auth configuration.
- Create: \`apps/api/src/auth/fastifyHandler.ts\` — official Web Request bridge.
- Create: \`apps/api/src/auth/sessionGuard.ts\` — session extraction.
- Create: \`apps/api/src/security/originGuard.ts\`.
- Create: \`apps/api/src/security/logRedaction.ts\`.
- Create: \`apps/api/src/jobs/jobRepository.ts\`.
- Create: \`apps/api/src/jobs/idempotency.ts\`.
- Create: \`apps/api/src/jobs/jobFiles.ts\`.
- Create: \`apps/api/src/jobs/clamdClient.ts\`.
- Create: \`apps/api/src/routes/capabilities.ts\`.
- Create: \`apps/api/src/routes/register.ts\`.
- Create: \`apps/api/src/routes/jobs.ts\`.
- Create: \`apps/api/src/routes/health.ts\`.
- Create: \`apps/api/src/server.ts\`.
- Create: \`apps/api/tests/auth.test.ts\`.
- Create: \`apps/api/tests/origin-consent.test.ts\`.
- Create: \`apps/api/tests/quota-idempotency.test.ts\`.
- Create: \`apps/api/tests/jobs-lifecycle.test.ts\`.
- Create: \`apps/api/tests/privacy.test.ts\`.

### Server worker

- Create: \`apps/worker/package.json\`.
- Create: \`apps/worker/tsconfig.json\`.
- Create: \`apps/worker/src/manifest.ts\`.
- Create: \`apps/worker/src/queue.ts\`.
- Create: \`apps/worker/src/processRunner.ts\`.
- Create: \`apps/worker/src/policies/office.ts\`.
- Create: \`apps/worker/src/policies/pandoc.ts\`.
- Create: \`apps/worker/src/policies/pdf.ts\`.
- Create: \`apps/worker/src/policies/ocr.ts\`.
- Create: \`apps/worker/src/policies/image.ts\`.
- Create: \`apps/worker/src/policies/bid.ts\`.
- Create: \`apps/worker/src/cleanup.ts\`.
- Create: \`apps/worker/src/main.ts\`.
- Create: \`apps/worker/tests/manifest.test.ts\`.
- Create: \`apps/worker/tests/allowlist.test.ts\`.
- Create: \`apps/worker/tests/queue.test.ts\`.
- Create: \`apps/worker/tests/cancellation.test.ts\`.
- Create: \`apps/worker/tests/cleanup.test.ts\`.

### Web integration and E2E

- Modify: \`apps/web/package.json\` — shared contracts, local conversion, Better Auth client, and tests.
- Modify: \`apps/web/src/pages/ConvertPage.tsx\` — real local/server capability UI.
- Create: \`apps/web/src/features/auth/authClient.ts\`.
- Create: \`apps/web/src/features/auth/AccountPanel.tsx\`.
- Create: \`apps/web/src/features/conversion/LocalConversionPanel.tsx\`.
- Create: \`apps/web/src/features/conversion/ServerConversionPanel.tsx\`.
- Create: \`apps/web/src/features/conversion/useConversionJob.ts\`.
- Create: \`apps/web/src/features/conversion/downloadJobResult.ts\`.
- Create: \`apps/web/src/features/conversion/ConvertPage.test.tsx\`.
- Create: \`apps/web/src/features/auth/AccountPanel.test.tsx\`.
- Create: \`tests/e2e/playwright.config.ts\`.
- Create: \`tests/e2e/conversion-local.spec.ts\`.
- Create: \`tests/e2e/auth-jobs.spec.ts\`.
- Create: \`tests/e2e/privacy-lifecycle.spec.ts\`.
- Create: \`tests/fixtures/conversion/manifest.json\`.
- Modify: \`package.json\` — workspace quality, API, worker, and E2E scripts.
- Modify: \`pnpm-lock.yaml\` — exact dependency graph.

### Task 1: Define strict conversion and job contracts

**Files:**
- Create: \`packages/contracts/src/conversion.ts\`
- Create: \`packages/contracts/src/jobs.ts\`
- Create: \`packages/contracts/src/api.ts\`
- Create: \`packages/contracts/src/index.ts\`
- Test: \`packages/contracts/tests/conversion.test.ts\`
- Test: \`packages/contracts/tests/jobs.test.ts\`

- [ ] **Step 1: Add the package and exact dependencies**

Create `packages/contracts/package.json` before running pnpm:

~~~json
{
  "name": "@opentrad/contracts",
  "version": "1.0.0",
  "private": true,
  "license": "AGPL-3.0-only",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --pretty false"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "24.3.0",
    "typescript": "5.9.2",
    "vitest": "3.2.6"
  }
}
~~~

Create `packages/contracts/tsconfig.json` by extending `../../tsconfig.base.json` with `lib: ["ES2022"]`, `types: ["vitest/globals"]`, and `include: ["src", "tests"]`. Create `tsconfig.build.json` with `noEmit: false`, `declaration: true`, `outDir: "dist"`, `rootDir: "src"`, and `include: ["src"]`.

Run:

~~~bash
pnpm add --filter @opentrad/contracts zod@4.4.3
~~~

Expected: pnpm creates the workspace dependency entries without changing existing application versions.

- [ ] **Step 2: Write failing capability tests**

~~~ts
import { describe, expect, it } from "vitest";
import { CAPABILITIES, ConversionCapabilitySchema } from "../src/index.js";

describe("conversion capabilities", () => {
  it("publishes the complete local-first matrix", () => {
    expect(CAPABILITIES.map((item) => item.id)).toEqual([
      "text.semantic",
      "document.generate",
      "docx.extract",
      "pdf.inspect",
      "pdf.organize",
      "image.convert",
      "images.to.pdf",
      "office.to.pdf",
      "spreadsheet.to.csv",
      "structured.convert",
      "ocr.pdf",
      "ocr.image",
      "image.convert.hq",
      "pdf.repair",
      "pdf.text-to-docx",
      "bid.assemble",
    ]);
  });

  it("locks experimental PDF to Word to grade C", () => {
    const capability = CAPABILITIES.find((item) => item.id === "pdf.text-to-docx");
    expect(capability?.quality).toBe("C");
    expect(capability?.caveatCodes).toContain("EXPERIMENTAL_REFLOW");
  });

  it("rejects unknown fields", () => {
    expect(() =>
      ConversionCapabilitySchema.parse({
        ...CAPABILITIES[0],
        sourceFilename: "private.docx",
      }),
    ).toThrow();
  });
});
~~~

- [ ] **Step 3: Run the capability test and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/contracts test -- conversion.test.ts
~~~

Expected: FAIL because \`CAPABILITIES\` and \`ConversionCapabilitySchema\` do not exist.

- [ ] **Step 4: Implement the conversion contract**

~~~ts
import { z } from "zod";

export const FileFormatSchema = z.enum([
  "txt", "md", "html", "doc", "docx", "odt", "rtf",
  "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp",
  "pdf", "png", "jpg", "webp", "avif", "opentrad",
]);
export type FileFormat = z.infer<typeof FileFormatSchema>;

export const ConversionGradeSchema = z.enum(["A", "B", "C"]);
export type ConversionGrade = z.infer<typeof ConversionGradeSchema>;

export const ConversionCapabilitySchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  inputFormats: z.array(FileFormatSchema).min(1),
  outputFormats: z.array(FileFormatSchema).min(1),
  execution: z.enum(["browser", "server"]),
  quality: ConversionGradeSchema,
  authRequired: z.boolean(),
  consentRequired: z.boolean(),
  limits: z.object({
    maxInputBytes: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive().optional(),
    maxFiles: z.number().int().positive().optional(),
    maxPages: z.number().int().positive().optional(),
  }).strict(),
  caveatCodes: z.array(z.string().min(1).max(64)).max(8),
}).strict();

export type ConversionCapability = z.infer<typeof ConversionCapabilitySchema>;

const MiB = 1024 * 1024;
export const CAPABILITIES = [
  { id: "text.semantic", label: "文本语义转换", inputFormats: ["txt", "md", "html"], outputFormats: ["txt", "md", "html"], execution: "browser", quality: "A", authRequired: false, consentRequired: false, limits: { maxInputBytes: 10 * MiB }, caveatCodes: [] },
  { id: "document.generate", label: "生成 DOCX/PDF", inputFormats: ["txt", "md", "html"], outputFormats: ["docx", "pdf"], execution: "browser", quality: "B", authRequired: false, consentRequired: false, limits: { maxInputBytes: 10 * MiB }, caveatCodes: ["LAYOUT_REFLOW"] },
  { id: "docx.extract", label: "提取 DOCX 内容", inputFormats: ["docx"], outputFormats: ["html", "md", "txt"], execution: "browser", quality: "B", authRequired: false, consentRequired: false, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["LAYOUT_REFLOW"] },
  { id: "pdf.inspect", label: "PDF 预览与提取", inputFormats: ["pdf"], outputFormats: ["txt", "png", "jpg"], execution: "browser", quality: "B", authRequired: false, consentRequired: false, limits: { maxInputBytes: 25 * MiB, maxPages: 80 }, caveatCodes: ["SCANNED_TEXT_MAY_BE_EMPTY"] },
  { id: "pdf.organize", label: "PDF 页面整理", inputFormats: ["pdf"], outputFormats: ["pdf"], execution: "browser", quality: "A", authRequired: false, consentRequired: false, limits: { maxInputBytes: 25 * MiB, maxFiles: 20, maxPages: 200 }, caveatCodes: [] },
  { id: "image.convert", label: "图片转换与压缩", inputFormats: ["png", "jpg", "webp", "avif"], outputFormats: ["png", "jpg", "webp", "avif"], execution: "browser", quality: "A", authRequired: false, consentRequired: false, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["LOSSY_TARGET_MAY_REDUCE_QUALITY"] },
  { id: "images.to.pdf", label: "图片合成 PDF", inputFormats: ["png", "jpg", "webp", "avif"], outputFormats: ["pdf"], execution: "browser", quality: "A", authRequired: false, consentRequired: false, limits: { maxInputBytes: 25 * MiB, maxTotalBytes: 50 * MiB, maxFiles: 80 }, caveatCodes: [] },
  { id: "office.to.pdf", label: "Office 转 PDF", inputFormats: ["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp"], outputFormats: ["pdf"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["LAYOUT_MAY_DIFFER_FROM_SOURCE_APP"] },
  { id: "spreadsheet.to.csv", label: "表格转 CSV", inputFormats: ["xls", "xlsx", "ods"], outputFormats: ["csv"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["ONE_SHEET_PER_RESULT"] },
  { id: "structured.convert", label: "结构化文档转换", inputFormats: ["docx", "odt", "rtf", "html", "md"], outputFormats: ["docx", "odt", "rtf", "html", "md"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["LAYOUT_REFLOW"] },
  { id: "ocr.pdf", label: "扫描 PDF OCR", inputFormats: ["pdf"], outputFormats: ["pdf", "txt"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB, maxPages: 20 }, caveatCodes: ["OCR_REQUIRES_REVIEW"] },
  { id: "ocr.image", label: "图片 OCR", inputFormats: ["png", "jpg", "webp"], outputFormats: ["txt", "pdf"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB }, caveatCodes: ["OCR_REQUIRES_REVIEW"] },
  { id: "image.convert.hq", label: "高质量图片转换", inputFormats: ["png", "jpg", "webp", "avif"], outputFormats: ["png", "jpg", "webp", "avif"], execution: "server", quality: "A", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB }, caveatCodes: [] },
  { id: "pdf.repair", label: "PDF 结构修复", inputFormats: ["pdf"], outputFormats: ["pdf"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB, maxPages: 80 }, caveatCodes: ["UNRECOVERABLE_CONTENT_MAY_BE_DROPPED"] },
  { id: "pdf.text-to-docx", label: "PDF 文字提取到 Word（实验）", inputFormats: ["pdf"], outputFormats: ["docx"], execution: "server", quality: "C", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB, maxPages: 80 }, caveatCodes: ["EXPERIMENTAL_REFLOW", "NO_LAYOUT_FIDELITY_PROMISE"] },
  { id: "bid.assemble", label: "标书附件组装", inputFormats: ["docx", "pdf", "png", "jpg"], outputFormats: ["docx", "pdf"], execution: "server", quality: "B", authRequired: true, consentRequired: true, limits: { maxInputBytes: 25 * MiB, maxTotalBytes: 50 * MiB, maxFiles: 40, maxPages: 80 }, caveatCodes: ["ATTACHMENTS_EMBED_AS_PAGE_IMAGES"] },
] as const satisfies readonly ConversionCapability[];

CAPABILITIES.forEach((item) => ConversionCapabilitySchema.parse(item));
~~~

- [ ] **Step 5: Write failing job privacy tests**

~~~ts
import { expect, it } from "vitest";
import { CreateJobRequestSchema, JobStatusSchema } from "../src/index.js";

it("rejects source filenames and document data", () => {
  expect(() => CreateJobRequestSchema.parse({
    operation: "office.to.pdf",
    inputFormat: "docx",
    outputFormat: "pdf",
    inputBytes: 12,
    sourceFilename: "secret.docx",
  })).toThrow();
  expect(() => JobStatusSchema.parse({
    id: crypto.randomUUID(),
    operation: "office.to.pdf",
    status: "queued",
    quality: "B",
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    body: "private text",
  })).toThrow();
});
~~~

- [ ] **Step 6: Implement strict job and API schemas**

~~~ts
import { z } from "zod";
import { ConversionGradeSchema, FileFormatSchema } from "./conversion.js";

export const ConversionOperationSchema = z.enum([
  "office.to.pdf", "spreadsheet.to.csv", "structured.convert",
  "ocr.pdf", "ocr.image", "image.convert.hq", "pdf.repair",
  "pdf.text-to-docx", "bid.assemble",
]);
export const JobStatusValueSchema = z.enum([
  "queued", "running", "succeeded", "failed", "cancelling", "cancelled",
]);
export const JobErrorCodeSchema = z.enum([
  "AUTH_REQUIRED", "ORIGIN_REJECTED", "PROCESSING_CONSENT_REQUIRED",
  "INVALID_REQUEST", "UNSUPPORTED_OPERATION", "UNSUPPORTED_FORMAT",
  "FILE_TOO_LARGE", "PAGE_LIMIT_EXCEEDED", "ENCRYPTED_INPUT",
  "MALWARE_DETECTED", "JOB_ALREADY_ACTIVE", "QUEUE_FULL",
  "DAILY_QUOTA_EXCEEDED", "IDEMPOTENCY_CONFLICT", "JOB_NOT_READY",
  "SCANNER_UNAVAILABLE", "CONVERSION_TIMEOUT", "CONVERSION_FAILED",
]);
export const CreateJobRequestSchema = z.object({
  operation: ConversionOperationSchema,
  inputFormat: FileFormatSchema,
  outputFormat: FileFormatSchema,
  inputBytes: z.number().int().positive().max(50 * 1024 * 1024),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
}).strict();
export const JobStatusSchema = z.object({
  id: z.string().uuid(),
  operation: ConversionOperationSchema,
  status: JobStatusValueSchema,
  quality: ConversionGradeSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime(),
  queuePosition: z.union([z.literal(0), z.literal(1)]).optional(),
  progress: z.object({
    phase: z.enum(["admission", "queued", "converting", "finalizing"]),
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }).strict().optional(),
  result: z.object({
    ready: z.literal(true),
    mediaType: z.string().min(1).max(100),
    sizeBytes: z.number().int().nonnegative(),
  }).strict().optional(),
  error: z.object({
    code: JobErrorCodeSchema,
    retryable: z.boolean(),
  }).strict().optional(),
}).strict();
export const RegisterRequestSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(12).max(128),
  acknowledgements: z.object({ noPasswordRecovery: z.literal(true) }).strict(),
}).strict();
~~~

- [ ] **Step 7: Run package gates and verify GREEN**

Run:

~~~bash
pnpm --filter @opentrad/contracts test
pnpm --filter @opentrad/contracts typecheck
pnpm --filter @opentrad/contracts build
~~~

Expected: all contract tests pass, TypeScript reports zero errors, and declarations are emitted.

- [ ] **Step 8: Commit the contract boundary**

~~~bash
git add packages/contracts package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: define conversion and job contracts"
~~~

### Task 2: Build the cancellable local Web Worker foundation

**Files:**
- Create: \`packages/conversion-local/src/protocol.ts\`
- Create: \`packages/conversion-local/src/client.ts\`
- Create: \`packages/conversion-local/src/worker.ts\`
- Create: \`packages/conversion-local/src/limits.ts\`
- Test: \`packages/conversion-local/tests/protocol.test.ts\`

- [ ] **Step 0: Scaffold the browser-only package**

Create `packages/conversion-local/package.json` with name `@opentrad/conversion-local`, version `1.0.0`, private/module/AGPL fields, the same `exports`/`files`/`build`/`test`/`typecheck` contract as `@opentrad/contracts`, dependency `@opentrad/contracts: "workspace:*"`, and exact development dependencies `@types/node: 24.3.0`, `typescript: 5.9.2`, and `vitest: 3.2.6`. Create its two tsconfigs exactly as Task 1 except `lib: ["ES2022", "DOM", "WebWorker"]`.

- [ ] **Step 1: Write the failing cancellation and size tests**

~~~ts
import { describe, expect, it, vi } from "vitest";
import { assertLocalFileLimit, LocalConversionClient } from "../src/index.js";

describe("local conversion worker", () => {
  it("rejects files above the local capability limit before posting bytes", () => {
    expect(() => assertLocalFileLimit("docx.extract", 25 * 1024 * 1024 + 1))
      .toThrow("LOCAL_FILE_TOO_LARGE");
  });

  it("terminates the worker after cancellation", async () => {
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Worker;
    const client = new LocalConversionClient(() => worker);
    const controller = new AbortController();
    controller.abort();
    await expect(client.run({
      id: crypto.randomUUID(),
      operation: "text.semantic",
      inputFormat: "txt",
      outputFormat: "md",
      bytes: new Uint8Array([65]),
    }, controller.signal)).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- protocol.test.ts
~~~

Expected: FAIL because the package and worker client do not exist.

- [ ] **Step 3: Implement the protocol and hard limits**

~~~ts
export type LocalOperation =
  | "text.semantic"
  | "document.generate"
  | "docx.extract"
  | "pdf.inspect"
  | "pdf.organize"
  | "image.convert"
  | "images.to.pdf";

export interface LocalConversionRequest {
  id: string;
  operation: LocalOperation;
  inputFormat: string;
  outputFormat: string;
  bytes: Uint8Array;
  options?: Readonly<Record<string, string | number | boolean>>;
}

export type LocalConversionResponse =
  | { id: string; ok: true; bytes: Uint8Array; mediaType: string }
  | { id: string; ok: false; code: string };

const LIMITS: Readonly<Record<LocalOperation, number>> = {
  "text.semantic": 10 * 1024 * 1024,
  "document.generate": 10 * 1024 * 1024,
  "docx.extract": 25 * 1024 * 1024,
  "pdf.inspect": 25 * 1024 * 1024,
  "pdf.organize": 50 * 1024 * 1024,
  "image.convert": 25 * 1024 * 1024,
  "images.to.pdf": 50 * 1024 * 1024,
};

export function assertLocalFileLimit(operation: LocalOperation, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > LIMITS[operation]) {
    throw new Error("LOCAL_FILE_TOO_LARGE");
  }
}
~~~

- [ ] **Step 4: Implement a one-request worker client**

~~~ts
import { assertLocalFileLimit, type LocalConversionRequest, type LocalConversionResponse } from "./protocol.js";

export class LocalConversionClient {
  constructor(
    private readonly createWorker: () => Worker,
    private readonly timeoutMs = 120_000,
  ) {}

  run(request: LocalConversionRequest, signal: AbortSignal): Promise<LocalConversionResponse & { ok: true }> {
    assertLocalFileLimit(request.operation, request.bytes.byteLength);
    const worker = this.createWorker();
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        worker.terminate();
      };
      const abort = () => {
        finish();
        reject(new Error("LOCAL_CONVERSION_CANCELLED"));
      };
      const timer = window.setTimeout(() => {
        finish();
        reject(new Error("LOCAL_CONVERSION_TIMEOUT"));
      }, this.timeoutMs);
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener("message", (event: MessageEvent<LocalConversionResponse>) => {
        if (event.data.id !== request.id) return;
        finish();
        if (!event.data.ok) {
          reject(new Error(event.data.code));
          return;
        }
        resolve(event.data);
      }, { once: true });
      worker.postMessage(request, [request.bytes.buffer]);
    });
  }
}
~~~

- [ ] **Step 5: Run worker foundation gates**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- protocol.test.ts
pnpm --filter @opentrad/conversion-local typecheck
~~~

Expected: cancellation and limit tests pass with zero leaked workers.

- [ ] **Step 6: Commit**

~~~bash
git add packages/conversion-local package.json pnpm-lock.yaml
git commit -m "feat: add local conversion worker foundation"
~~~

### Task 3: Implement TXT, Markdown, and sanitized HTML conversion

**Files:**
- Create: \`packages/conversion-local/src/text/semanticDocument.ts\`
- Create: \`packages/conversion-local/src/text/convertText.ts\`
- Test: \`packages/conversion-local/tests/text.test.ts\`

- [ ] **Step 1: Add exact semantic conversion dependencies**

Run:

~~~bash
pnpm add --filter @opentrad/conversion-local unified@11.0.5 remark-parse@11.0.0 remark-stringify@11.0.0 rehype-parse@9.0.1 rehype-stringify@10.0.1 rehype-sanitize@6.0.0 turndown@7.2.4
pnpm add --filter @opentrad/conversion-local --save-dev @types/turndown@5.0.6
~~~

Expected: only the local conversion package receives these dependencies.

- [ ] **Step 2: Write failing UTF-8, GB18030, and XSS tests**

~~~ts
import { expect, it } from "vitest";
import { convertSemanticText } from "../src/index.js";

it("decodes GB18030 and emits UTF-8 Markdown", async () => {
  const bytes = new Uint8Array([0xbf, 0xaa, 0xd4, 0xb4, 0xc9, 0xcc, 0xc3, 0xb3]);
  const result = await convertSemanticText(bytes, "txt", "md", "gb18030");
  expect(new TextDecoder().decode(result)).toContain("开源商贸");
});

it("removes scripts, event handlers, and javascript links", async () => {
  const source = new TextEncoder().encode(
    '<h1 onclick="alert(1)">标题</h1><script>alert(2)</script><a href="javascript:alert(3)">链接</a>',
  );
  const result = await convertSemanticText(source, "html", "html", "utf-8");
  const html = new TextDecoder().decode(result);
  expect(html).toContain("<h1>标题</h1>");
  expect(html).not.toMatch(/script|onclick|javascript:/i);
});
~~~

- [ ] **Step 3: Run the tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- text.test.ts
~~~

Expected: FAIL because \`convertSemanticText\` is missing.

- [ ] **Step 4: Implement strict decoding and conversion**

~~~ts
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import TurndownService from "turndown";
import { unified } from "unified";

type TextFormat = "txt" | "md" | "html";
type TextEncoding = "utf-8" | "gb18030";

const safeSchema = {
  ...defaultSchema,
  protocols: { href: ["http", "https", "mailto"] },
};

function decode(bytes: Uint8Array, encoding: TextEncoding): string {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export async function sanitizeHtmlFragment(value: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeSanitize, safeSchema)
    .use(rehypeStringify)
    .process(value);
  return String(file);
}

export async function convertSemanticText(
  bytes: Uint8Array,
  input: TextFormat,
  output: TextFormat,
  encoding: TextEncoding,
): Promise<Uint8Array> {
  const source = decode(bytes, encoding);
  let html: string;
  if (input === "html") {
    html = await sanitizeHtmlFragment(source);
  } else if (input === "md") {
    const markdownAst = unified().use(remarkParse).parse(source);
    const markdown = unified().use(remarkStringify).stringify(markdownAst);
    html = await sanitizeHtmlFragment("<pre>" + escapeHtml(markdown) + "</pre>");
  } else {
    html = await sanitizeHtmlFragment("<pre>" + escapeHtml(source) + "</pre>");
  }
  if (output === "html") return new TextEncoder().encode(html);
  const turndown = new TurndownService({ codeBlockStyle: "fenced", headingStyle: "atx" });
  const markdown = turndown.turndown(html);
  if (output === "md") return new TextEncoder().encode(markdown);
  const document = new DOMParser().parseFromString(html, "text/html");
  return new TextEncoder().encode(document.body.textContent ?? "");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
~~~

- [ ] **Step 5: Run text tests and fuzz malformed encodings**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- text.test.ts
pnpm --filter @opentrad/conversion-local test -- --runInBand
~~~

Expected: all semantic tests pass; invalid GB18030 and invalid UTF-8 produce controlled errors.

- [ ] **Step 6: Commit**

~~~bash
git add packages/conversion-local pnpm-lock.yaml
git commit -m "feat: add safe local text conversions"
~~~

### Task 4: Implement DOCX extraction and local image conversion

**Files:**
- Create: \`packages/conversion-local/src/docx/convertDocx.ts\`
- Create: \`packages/conversion-local/src/image/convertImage.ts\`
- Test: \`packages/conversion-local/tests/docx-security.test.ts\`
- Test: \`packages/conversion-local/tests/image.test.ts\`

- [ ] **Step 1: Add exact local binary dependencies**

Run:

~~~bash
pnpm add --filter @opentrad/conversion-local mammoth@1.12.1 @jsquash/avif@2.1.1 @jsquash/jpeg@1.6.0 @jsquash/webp@1.5.0 pdf-lib@1.17.1
~~~

Expected: all packages are bundled locally; no CDN URL is added.

- [ ] **Step 2: Write failing DOCX sanitization tests**

~~~ts
import { expect, it, vi } from "vitest";
import mammoth from "mammoth";
import { convertDocx } from "../src/index.js";

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn().mockResolvedValue({
      value: '<a href="javascript:alert(1)">bad</a><p>safe</p>',
      messages: [],
    }),
    extractRawText: vi.fn().mockResolvedValue({ value: "safe", messages: [] }),
  },
}));

it("never enables external file access and sanitizes Mammoth HTML", async () => {
  const output = await convertDocx(new Uint8Array([80, 75]), "html");
  expect(mammoth.convertToHtml).toHaveBeenCalledWith(
    { arrayBuffer: expect.any(ArrayBuffer) },
    expect.objectContaining({ externalFileAccess: false }),
  );
  expect(new TextDecoder().decode(output)).toBe("<a>bad</a><p>safe</p>");
});
~~~

- [ ] **Step 3: Run DOCX tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- docx-security.test.ts
~~~

Expected: FAIL because \`convertDocx\` is missing.

- [ ] **Step 4: Implement DOCX conversion behind the worker**

~~~ts
import mammoth from "mammoth";
import TurndownService from "turndown";
import { sanitizeHtmlFragment } from "../text/semanticDocument.js";

export async function convertDocx(
  bytes: Uint8Array,
  output: "html" | "md" | "txt",
): Promise<Uint8Array> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (output === "txt") {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return new TextEncoder().encode(result.value);
  }
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { externalFileAccess: false, includeDefaultStyleMap: true },
  );
  const html = await sanitizeHtmlFragment(result.value);
  if (output === "html") return new TextEncoder().encode(html);
  return new TextEncoder().encode(new TurndownService().turndown(html));
}
~~~

- [ ] **Step 5: Write failing image round-trip and pixel-limit tests**

~~~ts
import { expect, it } from "vitest";
import { assertPixelLimit, convertImage } from "../src/index.js";

it("rejects decompression bombs by decoded dimensions", () => {
  expect(() => assertPixelLimit(50_000, 50_000)).toThrow("IMAGE_PIXEL_LIMIT");
});

it("encodes AVIF without a network request", async () => {
  const pixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
  const result = await convertImage(pixels, "avif", 60);
  expect(result.byteLength).toBeGreaterThan(8);
});
~~~

- [ ] **Step 6: Implement deterministic image conversion**

~~~ts
import avifEncode from "@jsquash/avif/encode.js";
import jpegEncode from "@jsquash/jpeg/encode.js";
import webpEncode from "@jsquash/webp/encode.js";

export function assertPixelLimit(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width * height > 40_000_000) {
    throw new Error("IMAGE_PIXEL_LIMIT");
  }
}

export async function convertImage(
  image: ImageData,
  target: "png" | "jpg" | "webp" | "avif",
  quality: number,
): Promise<Uint8Array> {
  assertPixelLimit(image.width, image.height);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("IMAGE_QUALITY_INVALID");
  }
  if (target === "avif") return new Uint8Array(await avifEncode(image, { cqLevel: 63 - Math.round(quality * 0.63) }));
  if (target === "webp") return new Uint8Array(await webpEncode(image, { quality }));
  if (target === "jpg") return new Uint8Array(await jpegEncode(image, { quality }));
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("IMAGE_CANVAS_UNAVAILABLE");
  context.putImageData(image, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}
~~~

- [ ] **Step 7: Run package gates**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- docx-security.test.ts image.test.ts
pnpm --filter @opentrad/conversion-local typecheck
pnpm --filter @opentrad/conversion-local build
~~~

Expected: sanitized DOCX and local image tests pass with no network mocks invoked.

- [ ] **Step 8: Commit**

~~~bash
git add packages/conversion-local pnpm-lock.yaml
git commit -m "feat: add local docx and image conversion"
~~~

### Task 5: Implement secure PDF preview and page operations

**Files:**
- Create: \`packages/conversion-local/src/pdf/pdfjs.ts\`
- Create: \`packages/conversion-local/src/pdf/transformPdf.ts\`
- Test: \`packages/conversion-local/tests/pdf-security.test.ts\`
- Test: \`packages/conversion-local/tests/pdf-transform.test.ts\`

- [ ] **Step 1: Install the fixed PDF.js release**

Run:

~~~bash
pnpm add --filter @opentrad/conversion-local pdfjs-dist@6.2.108 pdf-lib@1.17.1
~~~

Expected: lockfile contains exactly \`pdfjs-dist@6.2.108\`.

- [ ] **Step 2: Write failing security configuration tests**

~~~ts
import { expect, it } from "vitest";
import { PDFJS_DOCUMENT_OPTIONS, PDFJS_VIEWER_OPTIONS } from "../src/index.js";

it("pins PDF.js security options", () => {
  expect(PDFJS_DOCUMENT_OPTIONS).toEqual({
    isEvalSupported: false,
    useWorkerFetch: false,
    stopEvent: true,
  });
  expect(PDFJS_VIEWER_OPTIONS).toEqual({
    enableScripting: false,
    disablePreferences: true,
  });
});
~~~

- [ ] **Step 3: Run the security test and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- pdf-security.test.ts
~~~

Expected: FAIL because the locked option objects do not exist.

- [ ] **Step 4: Implement the PDF.js wrapper without a scripting layer**

~~~ts
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const PDFJS_DOCUMENT_OPTIONS = Object.freeze({
  isEvalSupported: false,
  useWorkerFetch: false,
  stopEvent: true,
});

export const PDFJS_VIEWER_OPTIONS = Object.freeze({
  enableScripting: false,
  disablePreferences: true,
});

export async function loadLocalPdf(bytes: Uint8Array) {
  const task = getDocument({
    data: bytes,
    isEvalSupported: PDFJS_DOCUMENT_OPTIONS.isEvalSupported,
    useWorkerFetch: PDFJS_DOCUMENT_OPTIONS.useWorkerFetch,
  });
  return task.promise;
}
~~~

- [ ] **Step 5: Write failing merge, split, rotate, and reorder tests**

~~~ts
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import { organizePdf } from "../src/index.js";

it("applies an explicit page plan", async () => {
  const input = await PDFDocument.create();
  input.addPage([200, 300]);
  input.addPage([300, 200]);
  const bytes = await input.save();
  const output = await organizePdf([bytes], [
    { source: 0, page: 1, rotation: 90 },
    { source: 0, page: 0, rotation: 0 },
  ]);
  const parsed = await PDFDocument.load(output);
  expect(parsed.getPageCount()).toBe(2);
  expect(parsed.getPage(0).getRotation().angle).toBe(90);
});
~~~

- [ ] **Step 6: Implement page-plan-only PDF mutation**

~~~ts
import { degrees, PDFDocument } from "pdf-lib";

export interface PdfPagePlan {
  source: number;
  page: number;
  rotation: 0 | 90 | 180 | 270;
}

export async function organizePdf(
  sources: readonly Uint8Array[],
  plan: readonly PdfPagePlan[],
): Promise<Uint8Array> {
  if (sources.length < 1 || sources.length > 20 || plan.length < 1 || plan.length > 200) {
    throw new Error("PDF_PLAN_LIMIT");
  }
  const loaded = await Promise.all(sources.map((bytes) =>
    PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }),
  ));
  const target = await PDFDocument.create();
  for (const item of plan) {
    const source = loaded[item.source];
    if (!source || item.page < 0 || item.page >= source.getPageCount()) {
      throw new Error("PDF_PAGE_OUT_OF_RANGE");
    }
    const [copy] = await target.copyPages(source, [item.page]);
    copy.setRotation(degrees(item.rotation));
    target.addPage(copy);
  }
  return target.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}
~~~

- [ ] **Step 7: Run PDF tests and dependency assertion**

Run:

~~~bash
pnpm --filter @opentrad/conversion-local test -- pdf-security.test.ts pdf-transform.test.ts
pnpm why pdfjs-dist
~~~

Expected: tests pass and pnpm reports only PDF.js 6.2.108.

- [ ] **Step 8: Commit**

~~~bash
git add packages/conversion-local pnpm-lock.yaml
git commit -m "feat: add secure local pdf tools"
~~~

### Task 6: Create SQLite migrations and Better Auth configuration

**Files:**
- Create: \`apps/api/src/config.ts\`
- Create: \`apps/api/src/db/openDatabase.ts\`
- Create: \`apps/api/src/db/migrations/001_auth.sql\`
- Create: \`apps/api/src/db/migrations/002_jobs.sql\`
- Create: \`apps/api/src/db/migrate.ts\`
- Create: \`apps/api/src/auth/auth.ts\`
- Test: \`apps/api/tests/auth.test.ts\`

- [ ] **Step 1: Add exact API dependencies**

Create `apps/api/package.json` with name `@opentrad/api`, version `1.0.0`, private/module/AGPL fields, main `dist/server.js`, and scripts `build: "tsc -p tsconfig.build.json"`, `start: "node dist/server.js"`, `db:migrate: "node dist/db/migrate.js --apply"`, `test: "vitest run"`, and `typecheck: "tsc -p tsconfig.json --pretty false"`. Create its two tsconfigs exactly as Task 1 with `lib: ["ES2022"]` and Node/Vitest types.

Run:

~~~bash
pnpm add --filter @opentrad/api @opentrad/contracts@workspace:* fastify@5.12.1 better-auth@1.7.1 better-sqlite3@13.0.3 zod@4.4.3 @fastify/helmet@13.1.1 @fastify/multipart@10.1.1 @fastify/rate-limit@11.2.0 file-type@22.0.2
pnpm add --filter @opentrad/api --save-dev @types/better-sqlite3
~~~

Expected: API native dependencies are absent from the web package.

- [ ] **Step 2: Write failing auth option tests**

~~~ts
import { expect, it } from "vitest";
import { createAuthOptions } from "../src/auth/auth.js";

it("uses seven-day sessions and explicit account linking", () => {
  const options = createAuthOptions({
    baseUrl: "https://opentrad.dynv6.net",
    secret: "a".repeat(48),
    githubClientId: "client",
    githubClientSecret: "secret",
    databasePath: ":memory:",
  });
  expect(options.session).toMatchObject({ expiresIn: 604800, updateAge: 86400 });
  expect(options.emailAndPassword).toMatchObject({ enabled: true, minPasswordLength: 12 });
  expect(options.account?.accountLinking).toMatchObject({
    enabled: true,
    disableImplicitLinking: true,
    allowDifferentEmails: true,
    updateUserInfoOnLink: false,
  });
});
~~~

- [ ] **Step 3: Run auth tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/api test -- auth.test.ts
~~~

Expected: FAIL because \`createAuthOptions\` is missing.

- [ ] **Step 4: Implement validated configuration**

~~~ts
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  OPENTRAD_PUBLIC_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  AUTH_DATABASE_PATH: z.string().min(1),
  JOB_DATABASE_PATH: z.string().min(1),
  JOB_ROOT: z.string().min(1),
  CLAMD_HOST: z.string().min(1),
  CLAMD_PORT: z.coerce.number().int().min(1).max(65535),
}).strict();

export type ApiConfig = z.infer<typeof ConfigSchema>;
export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  return ConfigSchema.parse(env);
}
~~~

- [ ] **Step 5: Implement the database opener and reviewed job migration**

~~~ts
import Database from "better-sqlite3";

export function openDatabase(path: string): Database.Database {
  const database = new Database(path, { timeout: 5_000 });
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("busy_timeout = 5000");
  return database;
}
~~~

~~~sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_format TEXT NOT NULL,
  output_format TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('A','B','C')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelling','cancelled')),
  input_bytes INTEGER NOT NULL CHECK (input_bytes > 0),
  page_count INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  expires_at INTEGER NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
  error_code TEXT,
  result_bytes INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS jobs_owner_status ON jobs(owner_id, status);
CREATE INDEX IF NOT EXISTS jobs_expires ON jobs(expires_at);

CREATE TABLE IF NOT EXISTS daily_usage (
  owner_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  accepted_count INTEGER NOT NULL CHECK (accepted_count BETWEEN 0 AND 10),
  PRIMARY KEY (owner_id, utc_day)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency (
  owner_id TEXT NOT NULL,
  key_hmac TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_format TEXT NOT NULL,
  output_format TEXT NOT NULL,
  input_bytes INTEGER NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, key_hmac)
) STRICT;
~~~

- [ ] **Step 6: Generate and review the Better Auth 1.7.1 SQL**

Run:

~~~bash
BETTER_AUTH_SECRET="$(openssl rand -base64 48)" \
BETTER_AUTH_URL="https://opentrad.dynv6.net" \
pnpm exec auth@1.7.1 generate --config apps/api/src/auth/auth.ts --output apps/api/src/db/migrations/001_auth.sql
git diff -- apps/api/src/db/migrations/001_auth.sql
~~~

Expected: generated SQL contains Better Auth core tables plus username fields; no migration executes and no secret is written.

- [ ] **Step 7: Implement the Better Auth option factory**

~~~ts
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

export interface AuthEnvironment {
  baseUrl: string;
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
  databasePath: string;
}

export function createAuthOptions(env: AuthEnvironment) {
  return {
    baseURL: env.baseUrl,
    secret: env.secret,
    database: new Database(env.databasePath),
    trustedOrigins: [env.baseUrl],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    socialProviders: {
      github: {
        clientId: env.githubClientId,
        clientSecret: env.githubClientSecret,
        scope: ["user:email"],
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        updateUserInfoOnLink: false,
      },
    },
    advanced: {
      useSecureCookies: env.baseUrl.startsWith("https://"),
      cookiePrefix: "opentrad",
    },
    disabledPaths: ["/is-username-available"],
    plugins: [username({ immutableUsername: true, displayUsername: false })],
  } as const;
}

export function createAuth(env: AuthEnvironment) {
  return betterAuth(createAuthOptions(env));
}
~~~

- [ ] **Step 8: Run migration and auth gates**

Run:

~~~bash
pnpm --filter @opentrad/api test -- auth.test.ts
pnpm --filter @opentrad/api db:migrate -- --dry-run
pnpm --filter @opentrad/api typecheck
~~~

Expected: auth tests pass; dry-run prints migration IDs only and creates no database file.

- [ ] **Step 9: Commit**

~~~bash
git add apps/api packages/contracts package.json pnpm-lock.yaml
git commit -m "feat: add opentrad auth and sqlite foundation"
~~~

### Task 7: Mount Better Auth and implement privacy-safe registration

**Files:**
- Create: \`apps/api/src/auth/fastifyHandler.ts\`
- Create: \`apps/api/src/auth/sessionGuard.ts\`
- Create: \`apps/api/src/security/originGuard.ts\`
- Create: \`apps/api/src/security/logRedaction.ts\`
- Create: \`apps/api/src/routes/register.ts\`
- Create: \`apps/api/src/server.ts\`
- Test: \`apps/api/tests/origin-consent.test.ts\`
- Test: \`apps/api/tests/auth.test.ts\`

- [ ] **Step 1: Write failing origin and registration tests**

~~~ts
import { expect, it } from "vitest";
import { buildServer } from "../src/server.js";

it("rejects registration without the recovery acknowledgement", async () => {
  const app = await buildServer(testConfig());
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    headers: { origin: "https://opentrad.dynv6.net" },
    payload: { username: "trader", password: "correct-horse-12" },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe("INVALID_REQUEST");
});

it("rejects a foreign origin", async () => {
  const app = await buildServer(testConfig());
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    headers: { origin: "https://evil.example" },
    payload: {
      username: "trader",
      password: "correct-horse-12",
      acknowledgements: { noPasswordRecovery: true },
    },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("ORIGIN_REJECTED");
});
~~~

- [ ] **Step 2: Run auth route tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/api test -- auth.test.ts origin-consent.test.ts
~~~

Expected: FAIL because the server and registration route are missing.

- [ ] **Step 3: Implement exact same-origin enforcement**

~~~ts
import type { FastifyRequest } from "fastify";

export function requireSameOrigin(request: FastifyRequest, publicOrigin: string): void {
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  if (origin !== publicOrigin || (fetchSite !== undefined && fetchSite !== "same-origin")) {
    const error = new Error("ORIGIN_REJECTED");
    Object.assign(error, { statusCode: 403, code: "ORIGIN_REJECTED" });
    throw error;
  }
}
~~~

- [ ] **Step 4: Implement the Fastify Web Request bridge**

~~~ts
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";

export function mountAuthHandler(app: FastifyInstance, auth: ReturnType<typeof createAuth>): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, "https://opentrad.dynv6.net");
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        body: request.method === "GET" ? undefined : JSON.stringify(request.body ?? {}),
      }));
      reply.status(response.status);
      response.headers.forEach((value, name) => reply.header(name, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
~~~

- [ ] **Step 5: Implement registration with a random internal alias**

~~~ts
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { RegisterRequestSchema } from "@opentrad/contracts";

export function registerRegistrationRoute(
  app: FastifyInstance,
  auth: ReturnType<typeof createAuth>,
  publicOrigin: string,
): void {
  app.post("/api/v1/register", async (request, reply) => {
    requireSameOrigin(request, publicOrigin);
    const body = RegisterRequestSchema.parse(request.body);
    const alias = randomBytes(18).toString("base64url") + "@users.opentrad.invalid";
    const result = await auth.api.signUpEmail({
      body: {
        email: alias,
        name: body.username,
        username: body.username,
        password: body.password,
      },
      returnHeaders: true,
    });
    result.headers.forEach((value, name) => reply.header(name, value));
    return reply.status(201).send({
      user: { id: result.response.user.id, username: body.username },
      recoveryAvailable: false,
    });
  });
}
~~~

- [ ] **Step 6: Configure structured redaction**

~~~ts
export const LOGGER_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers.idempotency-key",
  "req.headers.x-opentrad-processing-consent",
  "res.headers.set-cookie",
  "password",
  "email",
] as const;
~~~

- [ ] **Step 7: Run auth route tests**

Run:

~~~bash
pnpm --filter @opentrad/api test -- auth.test.ts origin-consent.test.ts
pnpm --filter @opentrad/api typecheck
~~~

Expected: foreign origins and missing acknowledgements fail; valid registration returns 201 without an email field.

- [ ] **Step 8: Commit**

~~~bash
git add apps/api
git commit -m "feat: add secure username and github authentication"
~~~

### Task 8: Implement quotas, idempotency, upload consent, and ClamAV admission

**Files:**
- Create: \`apps/api/src/jobs/jobRepository.ts\`
- Create: \`apps/api/src/jobs/idempotency.ts\`
- Create: \`apps/api/src/jobs/jobFiles.ts\`
- Create: \`apps/api/src/jobs/clamdClient.ts\`
- Create: \`apps/api/src/routes/jobs.ts\`
- Create: \`apps/api/src/routes/capabilities.ts\`
- Test: \`apps/api/tests/quota-idempotency.test.ts\`
- Test: \`apps/api/tests/jobs-lifecycle.test.ts\`
- Test: \`apps/api/tests/privacy.test.ts\`

- [ ] **Step 1: Write failing quota and idempotency tests**

~~~ts
it("accepts only one running and one queued job globally", () => {
  repository.createJob(jobInput({ ownerId: "u1" }));
  repository.markRunning(firstJobId);
  repository.createJob(jobInput({ ownerId: "u2" }));
  expect(() => repository.createJob(jobInput({ ownerId: "u3" }))).toThrow("QUEUE_FULL");
});

it("returns the original job for the same idempotency key and shape", () => {
  const first = repository.createJob(jobInput({ idempotencyKey: "repeatable-key-1234" }));
  const second = repository.createJob(jobInput({ idempotencyKey: "repeatable-key-1234" }));
  expect(second.id).toBe(first.id);
});

it("rejects key reuse with different non-content metadata", () => {
  repository.createJob(jobInput({ idempotencyKey: "repeatable-key-1234", inputBytes: 10 }));
  expect(() => repository.createJob(
    jobInput({ idempotencyKey: "repeatable-key-1234", inputBytes: 11 }),
  )).toThrow("IDEMPOTENCY_CONFLICT");
});
~~~

- [ ] **Step 2: Run repository tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/api test -- quota-idempotency.test.ts
~~~

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement atomic quota admission**

~~~ts
import { createHmac, randomUUID } from "node:crypto";

export class JobRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly idempotencySecret: string,
    private readonly clock: () => number = Date.now,
  ) {}

  createJob(input: CreateJobInput): JobRecord {
    return this.database.transaction(() => {
      const now = this.clock();
      const keyHmac = createHmac("sha256", this.idempotencySecret)
        .update(input.ownerId).update("\0").update(input.idempotencyKey).digest("base64url");
      const existing = this.findIdempotency(input.ownerId, keyHmac);
      if (existing) {
        if (existing.operation !== input.operation ||
            existing.inputFormat !== input.inputFormat ||
            existing.outputFormat !== input.outputFormat ||
            existing.inputBytes !== input.inputBytes) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return this.getOwnedJob(input.ownerId, existing.jobId);
      }
      if (this.countGlobalActive() >= 2) throw new Error("QUEUE_FULL");
      if (this.countOwnerActive(input.ownerId) >= 1) throw new Error("JOB_ALREADY_ACTIVE");
      const utcDay = new Date(now).toISOString().slice(0, 10);
      if (this.getDailyCount(input.ownerId, utcDay) >= 10) {
        throw new Error("DAILY_QUOTA_EXCEEDED");
      }
      const record = {
        id: randomUUID(),
        ...input,
        status: "queued" as const,
        createdAt: now,
        expiresAt: now + 15 * 60_000,
      };
      this.insertJob(record);
      this.incrementDailyCount(input.ownerId, utcDay);
      this.insertIdempotency(input.ownerId, keyHmac, record);
      return record;
    }).immediate();
  }
}
~~~

- [ ] **Step 4: Write failing consent tests**

~~~ts
it("does not consume multipart bytes before consent validation", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: {
      origin: publicOrigin,
      cookie: sessionCookie,
      "idempotency-key": "consent-test-key-1234",
      "content-type": "multipart/form-data; boundary=x",
    },
    payload: "--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"private.docx\"\r\n\r\nSENTINEL\r\n--x--\r\n",
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("PROCESSING_CONSENT_REQUIRED");
  expect(await listJobFiles()).toEqual([]);
});
~~~

- [ ] **Step 5: Implement header admission before multipart parsing**

~~~ts
export function requireJobAdmissionHeaders(request: FastifyRequest, publicOrigin: string): string {
  requireSameOrigin(request, publicOrigin);
  if (request.headers["x-opentrad-processing-consent"] !== "server-v1") {
    throw httpError(403, "PROCESSING_CONSENT_REQUIRED");
  }
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x21-\x7e]{16,128}$/.test(key)) {
    throw httpError(400, "INVALID_REQUEST");
  }
  return key;
}
~~~

- [ ] **Step 6: Implement the ClamAV INSTREAM client**

~~~ts
import { connect } from "node:net";

export function scanWithClamd(
  chunks: AsyncIterable<Uint8Array>,
  host: string,
  port: number,
): Promise<"clean" | "infected"> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let response = "";
    socket.setTimeout(30_000, () => socket.destroy(new Error("SCANNER_UNAVAILABLE")));
    socket.on("connect", async () => {
      socket.write("zINSTREAM\0");
      try {
        for await (const chunk of chunks) {
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.byteLength);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      } catch (error) {
        socket.destroy(error as Error);
      }
    });
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.on("end", () => {
      if (response.includes(" FOUND")) resolve("infected");
      else if (response.includes(" OK")) resolve("clean");
      else reject(new Error("SCANNER_UNAVAILABLE"));
    });
    socket.on("error", reject);
  });
}
~~~

- [ ] **Step 7: Implement randomized ephemeral job paths**

~~~ts
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export class JobFiles {
  constructor(private readonly root: string) {}
  path(state: "staging" | "queued" | "running" | "done", jobId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("INVALID_JOB_ID");
    return join(this.root, state, jobId);
  }
  async createStaging(jobId: string): Promise<string> {
    const directory = this.path("staging", jobId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const handle = await open(join(directory, "input.bin"), "wx", 0o600);
    await handle.close();
    return directory;
  }
  async admit(jobId: string): Promise<void> {
    await rename(this.path("staging", jobId), this.path("queued", jobId));
  }
  async destroy(jobId: string): Promise<void> {
    for (const state of ["staging", "queued", "running", "done"] as const) {
      await rm(this.path(state, jobId), { recursive: true, force: true });
    }
  }
}
~~~

- [ ] **Step 8: Implement job routes**

Create routes with these exact behaviors:

~~~ts
app.get("/api/v1/capabilities", async () => ({ capabilities: CAPABILITIES }));
app.post("/api/v1/jobs", { preHandler: [requireSession] }, createJobHandler);
app.get("/api/v1/jobs/:id", { preHandler: [requireSession] }, getJobHandler);
app.get("/api/v1/jobs/:id/result", { preHandler: [requireSession] }, streamResultHandler);
app.delete("/api/v1/jobs/:id", { preHandler: [requireSession] }, cancelJobHandler);
~~~

\`streamResultHandler\` must set \`Cache-Control: no-store\`, \`Accept-Ranges: none\`, generate \`opentrad-<operation>-<UTC date>.<extension>\`, stream with \`pipeline\`, and call \`JobFiles.destroy(jobId)\` only after successful completion. It must never use the upload filename.

- [ ] **Step 9: Run lifecycle and privacy tests**

Run:

~~~bash
pnpm --filter @opentrad/api test -- quota-idempotency.test.ts jobs-lifecycle.test.ts privacy.test.ts
pnpm --filter @opentrad/api typecheck
~~~

Expected: quotas, replay, consent-before-read, malware rejection, one-shot download, and sentinel privacy tests pass.

- [ ] **Step 10: Commit**

~~~bash
git add apps/api packages/contracts
git commit -m "feat: add private conversion job admission"
~~~

### Task 9: Implement the no-shell server command allowlist

**Files:**
- Create: \`apps/worker/src/manifest.ts\`
- Create: \`apps/worker/src/processRunner.ts\`
- Create: \`apps/worker/src/policies/office.ts\`
- Create: \`apps/worker/src/policies/pandoc.ts\`
- Create: \`apps/worker/src/policies/pdf.ts\`
- Create: \`apps/worker/src/policies/ocr.ts\`
- Create: \`apps/worker/src/policies/image.ts\`
- Create: \`apps/worker/src/policies/bid.ts\`
- Test: \`apps/worker/tests/manifest.test.ts\`
- Test: \`apps/worker/tests/allowlist.test.ts\`

- [ ] **Step 0: Scaffold the networkless worker package**

Create `apps/worker/package.json` with name `@opentrad/worker`, version `1.0.0`, private/module/AGPL fields, main `dist/main.js`, and scripts `build: "tsc -p tsconfig.build.json"`, `start: "node dist/main.js"`, `test: "vitest run"`, and `typecheck: "tsc -p tsconfig.json --pretty false"`. Create its two tsconfigs exactly as the API package. Then run:

~~~bash
pnpm add --filter @opentrad/worker @opentrad/contracts@workspace:* zod@4.4.3
pnpm add --filter @opentrad/worker --save-dev @types/node@24.3.0 vitest@3.2.6 typescript@5.9.2
~~~

Expected: the worker has no HTTP client, browser dependency, or shell-wrapper dependency.

- [ ] **Step 1: Write failing manifest and injection tests**

~~~ts
import { expect, it } from "vitest";
import { buildCommand, WorkerManifestSchema } from "../src/index.js";

it("rejects arbitrary command fields", () => {
  expect(() => WorkerManifestSchema.parse({
    schemaVersion: "server-v1",
    jobId: crypto.randomUUID(),
    operation: "office.to.pdf",
    inputFormat: "docx",
    outputFormat: "pdf",
    command: "curl https://example.invalid",
  })).toThrow();
});

it("never passes user options through as argv", () => {
  const command = buildCommand({
    schemaVersion: "server-v1",
    jobId: crypto.randomUUID(),
    operation: "structured.convert",
    inputFormat: "docx",
    outputFormat: "md",
    options: { writer: "--lua-filter=/work/evil.lua" },
  }, "/work/input.bin", "/work/result.md");
  expect(command.argv.join(" ")).not.toContain("lua-filter");
  expect(command.shell).toBe(false);
});
~~~

- [ ] **Step 2: Run allowlist tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/worker test -- manifest.test.ts allowlist.test.ts
~~~

Expected: FAIL because the manifest schema and policy dispatcher are missing.

- [ ] **Step 3: Implement a strict manifest**

~~~ts
import { ConversionOperationSchema, FileFormatSchema } from "@opentrad/contracts";
import { z } from "zod";

export const WorkerManifestSchema = z.object({
  schemaVersion: z.literal("server-v1"),
  jobId: z.string().uuid(),
  operation: ConversionOperationSchema,
  inputFormat: FileFormatSchema,
  outputFormat: FileFormatSchema,
  options: z.object({
    language: z.enum(["chi_sim", "eng", "chi_sim+eng"]).optional(),
    sheetIndex: z.number().int().min(0).max(255).optional(),
  }).strict().default({}),
}).strict();
export type WorkerManifest = z.infer<typeof WorkerManifestSchema>;
~~~

- [ ] **Step 4: Implement fixed command policies**

~~~ts
export interface CommandSpec {
  executable: string;
  argv: readonly string[];
  timeoutMs: number;
  shell: false;
  environment: Readonly<Record<string, string>>;
}

export function officeToPdf(input: string, outputDirectory: string, profile: string): CommandSpec {
  return {
    executable: "/usr/bin/soffice",
    argv: [
      "--headless", "--nologo", "--nodefault", "--nolockcheck",
      "--nofirststartwizard", "-env:UserInstallation=file://" + profile,
      "--convert-to", "pdf", "--outdir", outputDirectory, input,
    ],
    timeoutMs: 120_000,
    shell: false,
    environment: { HOME: profile, TMPDIR: profile, SAL_DISABLE_OPENCL: "1" },
  };
}

export function pandocConvert(input: string, output: string, from: string, to: string): CommandSpec {
  return {
    executable: "/usr/bin/pandoc",
    argv: ["--sandbox", "--from", from, "--to", to, "--output", output, input],
    timeoutMs: 120_000,
    shell: false,
    environment: { HOME: "/work/home", TMPDIR: "/work/tmp" },
  };
}

export function ocrPdf(input: string, output: string, language: string): CommandSpec {
  return {
    executable: "/opt/ocr/bin/ocrmypdf",
    argv: [
      "--rasterizer", "pypdfium", "--output-type", "pdf", "--optimize", "0",
      "--jobs", "1", "--tesseract-timeout", "120", "--language", language,
      input, output,
    ],
    timeoutMs: 300_000,
    shell: false,
    environment: { HOME: "/work/home", TMPDIR: "/work/tmp", OMP_THREAD_LIMIT: "1" },
  };
}

export function repairPdf(input: string, output: string): CommandSpec {
  return {
    executable: "/usr/bin/qpdf",
    argv: ["--warning-exit-0", "--object-streams=generate", input, output],
    timeoutMs: 120_000,
    shell: false,
    environment: { HOME: "/work/home", TMPDIR: "/work/tmp" },
  };
}

export function convertImageHighQuality(input: string, output: string): CommandSpec {
  return {
    executable: "/usr/bin/vips",
    argv: ["copy", input, output, "--strip"],
    timeoutMs: 60_000,
    shell: false,
    environment: {
      HOME: "/work/home", TMPDIR: "/work/tmp",
      VIPS_BLOCK_UNTRUSTED: "TRUE", VIPS_CONCURRENCY: "1",
    },
  };
}
~~~

- [ ] **Step 5: Implement a process-group runner**

~~~ts
import { spawn } from "node:child_process";

export function runCommand(spec: CommandSpec, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, [...spec.argv], {
      shell: false,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin:/opt/ocr/bin", ...spec.environment },
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 64 * 1024) child.kill("SIGKILL");
    });
    const kill = () => {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 2_000).unref();
    };
    const timer = setTimeout(kill, spec.timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      if (signal.aborted) reject(new Error("JOB_CANCELLED"));
      else if (code === 0) resolve();
      else reject(new Error("CONVERSION_FAILED"));
    });
  });
}
~~~

- [ ] **Step 6: Add bid assembly policy**

The policy must compile the editable bid body through \`@opentrad/document-core\`, render it through the shared DOCX renderer, rasterize attachments with Poppler at 180 DPI, and insert attachment pages as JPEG images. The command list is fixed:

~~~ts
export const ATTACHMENT_RASTER_COMMAND = Object.freeze({
  executable: "/usr/bin/pdftoppm",
  baseArgv: ["-jpeg", "-r", "180", "-f", "1", "-l", "80"],
  timeoutMs: 180_000,
  shell: false as const,
});
~~~

The generated cover must state that attachments are page images and the editable body does not imply editable attachments.

- [ ] **Step 7: Run worker policy gates**

Run:

~~~bash
pnpm --filter @opentrad/worker test -- manifest.test.ts allowlist.test.ts
pnpm --filter @opentrad/worker typecheck
~~~

Expected: injection strings never reach argv, every server capability maps to exactly one policy, and no policy sets \`shell: true\`.

- [ ] **Step 8: Commit**

~~~bash
git add apps/worker packages/contracts package.json pnpm-lock.yaml
git commit -m "feat: add allowlisted conversion worker policies"
~~~

### Task 10: Implement atomic queue claims, cancellation, and TTL cleanup

**Files:**
- Create: \`apps/worker/src/queue.ts\`
- Create: \`apps/worker/src/cleanup.ts\`
- Create: \`apps/worker/src/main.ts\`
- Test: \`apps/worker/tests/queue.test.ts\`
- Test: \`apps/worker/tests/cancellation.test.ts\`
- Test: \`apps/worker/tests/cleanup.test.ts\`

- [ ] **Step 1: Write failing queue recovery tests**

~~~ts
it("claims a queued directory with one atomic rename", async () => {
  await fixture.createQueued(jobId);
  const claim = await queue.claimNext();
  expect(claim?.jobId).toBe(jobId);
  expect(await fixture.exists("queued", jobId)).toBe(false);
  expect(await fixture.exists("running", jobId)).toBe(true);
});

it("removes all files for expired jobs after restart", async () => {
  await fixture.createInEveryState(jobId, Date.now() - 16 * 60_000);
  await cleanupExpiredJobs(fixture.root, Date.now());
  expect(await fixture.findJobFiles(jobId)).toEqual([]);
});
~~~

- [ ] **Step 2: Run queue tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/worker test -- queue.test.ts cleanup.test.ts
~~~

Expected: FAIL because queue claim and cleanup are missing.

- [ ] **Step 3: Implement atomic claims and atomic status files**

~~~ts
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class WorkerQueue {
  constructor(private readonly root: string) {}

  async claimNext(): Promise<{ jobId: string; directory: string } | null> {
    const entries = (await readdir(join(this.root, "queued"))).sort();
    for (const jobId of entries) {
      const source = join(this.root, "queued", jobId);
      const target = join(this.root, "running", jobId);
      try {
        await rename(source, target);
        return { jobId, directory: target };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  async writeStatus(directory: string, status: object): Promise<void> {
    const temporary = join(directory, "status.json.tmp");
    await writeFile(temporary, JSON.stringify(status), { mode: 0o600, flag: "w" });
    await rename(temporary, join(directory, "status.json"));
  }
}
~~~

- [ ] **Step 4: Implement cancellation polling**

~~~ts
export async function runClaim(claim: Claim, queue: WorkerQueue): Promise<void> {
  const controller = new AbortController();
  const poll = setInterval(async () => {
    if (await fileExists(join(claim.directory, "cancel"))) controller.abort();
  }, 250);
  try {
    const manifest = WorkerManifestSchema.parse(
      JSON.parse(await readFile(join(claim.directory, "request.json"), "utf8")),
    );
    await executeManifest(manifest, claim.directory, controller.signal);
    await queue.writeStatus(claim.directory, { status: "succeeded", completedAt: Date.now() });
  } catch (error) {
    await queue.writeStatus(claim.directory, {
      status: controller.signal.aborted ? "cancelled" : "failed",
      errorCode: controller.signal.aborted ? "JOB_CANCELLED" : normalizeWorkerError(error),
      completedAt: Date.now(),
    });
  } finally {
    clearInterval(poll);
    await rename(claim.directory, claim.directory.replace("/running/", "/done/"));
  }
}
~~~

- [ ] **Step 5: Implement fifteen-minute cleanup**

~~~ts
export async function cleanupExpiredJobs(root: string, now: number): Promise<void> {
  for (const state of ["staging", "queued", "running", "done"]) {
    const directory = join(root, state);
    for (const jobId of await safeReaddir(directory)) {
      const manifest = await readExpiry(join(directory, jobId));
      if (manifest.expiresAt <= now) {
        await rm(join(directory, jobId), { recursive: true, force: true });
      }
    }
  }
}
~~~

- [ ] **Step 6: Run cancellation and restart tests**

Run:

~~~bash
pnpm --filter @opentrad/worker test -- queue.test.ts cancellation.test.ts cleanup.test.ts
pnpm --filter @opentrad/worker typecheck
~~~

Expected: queued claims are exclusive, cancellation kills the process group, and every expired state is empty.

- [ ] **Step 7: Commit**

~~~bash
git add apps/worker
git commit -m "feat: add worker queue cancellation and cleanup"
~~~

### Task 11: Integrate account and conversion UI

**Files:**
- Modify: \`apps/web/src/pages/ConvertPage.tsx\`
- Create: \`apps/web/src/features/auth/authClient.ts\`
- Create: \`apps/web/src/features/auth/AccountPanel.tsx\`
- Create: \`apps/web/src/features/conversion/LocalConversionPanel.tsx\`
- Create: \`apps/web/src/features/conversion/ServerConversionPanel.tsx\`
- Create: \`apps/web/src/features/conversion/useConversionJob.ts\`
- Create: \`apps/web/src/features/conversion/downloadJobResult.ts\`
- Test: \`apps/web/src/features/conversion/ConvertPage.test.tsx\`
- Test: \`apps/web/src/features/auth/AccountPanel.test.tsx\`

- [ ] **Step 1: Add the Better Auth React client**

Run:

~~~bash
pnpm add --filter @opentrad/web @opentrad/contracts@workspace:* @opentrad/conversion-local@workspace:* better-auth@1.7.1
~~~

Expected: web receives client-safe packages only.

- [ ] **Step 2: Write failing anonymous/local and consent tests**

~~~tsx
it("runs local conversion without a session", async () => {
  render(<ConvertPage />);
  await userEvent.upload(screen.getByLabelText("选择本地文件"), textFile);
  await userEvent.click(screen.getByRole("button", { name: "本地转换" }));
  expect(await screen.findByText("转换完成，文件未离开浏览器")).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps server submission disabled until consent is checked", async () => {
  render(<ServerConversionPanel session={session} />);
  await userEvent.upload(screen.getByLabelText("选择服务器处理文件"), docxFile);
  expect(screen.getByRole("button", { name: "提交服务器处理" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", {
    name: "我同意本次文件上传到 OpenTrad 服务器处理",
  }));
  expect(screen.getByRole("button", { name: "提交服务器处理" })).toBeEnabled();
});
~~~

- [ ] **Step 3: Run web tests and verify RED**

Run:

~~~bash
pnpm --filter @opentrad/web test -- ConvertPage.test.tsx AccountPanel.test.tsx
~~~

Expected: FAIL because the real panels and auth client are missing.

- [ ] **Step 4: Implement same-origin auth client**

~~~ts
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [usernameClient({ displayUsername: false })],
});
~~~

- [ ] **Step 5: Implement server job submission with explicit consent**

~~~ts
export async function submitServerJob(
  request: CreateJobRequest,
  file: File,
  idempotencyKey: string,
): Promise<JobStatus> {
  const body = new FormData();
  body.append("request", JSON.stringify(request));
  body.append("file", file, "upload.bin");
  const response = await fetch("/api/v1/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Idempotency-Key": idempotencyKey,
      "X-OpenTrad-Processing-Consent": "server-v1",
    },
    body,
  });
  if (!response.ok) throw await readApiError(response);
  return JobStatusSchema.parse((await response.json()).job);
}
~~~

- [ ] **Step 6: Enforce Pages preview mode**

~~~ts
export const SERVER_FEATURES_ENABLED =
  import.meta.env.VITE_DEPLOYMENT_MODE === "production" &&
  window.location.hostname === "opentrad.dynv6.net";
~~~

When false, render: “GitHub Pages 为本地功能预览；服务器转换仅在 opentrad.dynv6.net 开放。” Do not render a clickable login or upload action.

- [ ] **Step 7: Implement accessible job polling and cancellation**

Poll \`GET /api/v1/jobs/:id\` every 1.5 seconds while queued/running, stop on terminal state or unmount, and expose:

~~~tsx
<div role="status" aria-live="polite">
  {status === "queued" && "排队中，当前最多仅保留 1 个等待任务"}
  {status === "running" && "处理中，可随时取消"}
  {status === "succeeded" && "处理完成，请在 15 分钟内下载"}
</div>
~~~

The cancel button calls \`DELETE /api/v1/jobs/:id\` with same-origin credentials and then continues polling until cancelled.

- [ ] **Step 8: Run responsive web tests**

Run:

~~~bash
pnpm --filter @opentrad/web test -- ConvertPage.test.tsx AccountPanel.test.tsx
pnpm --filter @opentrad/web typecheck
pnpm --filter @opentrad/web build
~~~

Expected: anonymous local flow, account warning, explicit link flow, consent, queue, cancel, and download UI pass.

- [ ] **Step 9: Commit**

~~~bash
git add apps/web packages/conversion-local packages/contracts pnpm-lock.yaml
git commit -m "feat: connect local and server conversion experiences"
~~~

### Task 12: Add end-to-end lifecycle, security, and privacy verification

**Files:**
- Create: \`tests/e2e/playwright.config.ts\`
- Create: \`tests/e2e/conversion-local.spec.ts\`
- Create: \`tests/e2e/auth-jobs.spec.ts\`
- Create: \`tests/e2e/privacy-lifecycle.spec.ts\`
- Create: \`tests/fixtures/conversion/manifest.json\`
- Modify: \`package.json\`

- [ ] **Step 1: Write the local E2E test**

~~~ts
test("anonymous local PDF organization never calls the API", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiCalls.push(request.url());
  });
  await page.goto("/convert");
  await page.getByLabel("选择本地文件").setInputFiles("tests/fixtures/conversion/two-pages.pdf");
  await page.getByRole("button", { name: "本地转换" }).click();
  await expect(page.getByText("转换完成，文件未离开浏览器")).toBeVisible();
  expect(apiCalls).toEqual([]);
});
~~~

- [ ] **Step 2: Write the authenticated lifecycle E2E test**

~~~ts
test("server job requires consent, supports cancellation, and deletes results", async ({ page }) => {
  await registerUsernameUser(page, "e2e-user", "correct-horse-battery-12");
  await page.goto("/convert");
  await page.getByLabel("选择服务器处理文件").setInputFiles("tests/fixtures/conversion/simple.docx");
  await expect(page.getByRole("button", { name: "提交服务器处理" })).toBeDisabled();
  await page.getByRole("checkbox", {
    name: "我同意本次文件上传到 OpenTrad 服务器处理",
  }).check();
  await page.getByRole("button", { name: "提交服务器处理" }).click();
  await expect(page.getByRole("status")).toContainText(/排队中|处理中/);
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByRole("status")).toContainText("已取消");
  expect(await readEphemeralJobFiles()).toEqual([]);
});
~~~

- [ ] **Step 3: Add the privacy sentinel test**

~~~ts
test("sentinel content never enters metadata or logs", async ({ request }) => {
  const sentinelName = "PRIVATE_FILENAME_SENTINEL.docx";
  const sentinelBody = "PRIVATE_BODY_SENTINEL_8f9d2c";
  await submitFixture(request, sentinelName, sentinelBody);
  await expireAllJobs();
  const searchable = await collectTextFrom([
    testPaths.apiLog,
    testPaths.workerLog,
    testPaths.authDatabaseDump,
    testPaths.jobsDatabaseDump,
    testPaths.backupDump,
  ]);
  expect(searchable).not.toContain(sentinelName);
  expect(searchable).not.toContain(sentinelBody);
  expect(await readEphemeralJobFiles()).toEqual([]);
});
~~~

- [ ] **Step 4: Run E2E in desktop and mobile projects**

Run:

~~~bash
pnpm e2e --project=chromium-desktop
pnpm e2e --project=chromium-mobile
~~~

Expected: all anonymous, authenticated, consent, queue, cancel, TTL, download, and privacy tests pass in both projects.

- [ ] **Step 5: Run malicious and malformed corpus tests**

Run:

~~~bash
pnpm --filter @opentrad/worker test:corpus
pnpm --filter @opentrad/api test:integration
~~~

Expected: encrypted PDF, malformed PDF, Office ZIP bomb, invalid UTF-8, invalid GB18030, oversized image dimensions, ClamAV EICAR generated fixture, cancellation, and timeout cases return stable error codes without residual files.

- [ ] **Step 6: Commit**

~~~bash
git add tests package.json pnpm-lock.yaml
git commit -m "test: cover conversion auth and privacy lifecycles"
~~~

### Task 13: Run full gates and prepare the production handoff

**Files:**
- Modify: \`README.md\`
- Modify: \`THIRD_PARTY_NOTICES.md\`
- Modify: \`package.json\`

- [ ] **Step 1: Document capability grades and privacy boundaries**

Add tables for all 16 capability IDs, their A/B/C grade, local/server execution, limits, and caveats. State that Mammoth output is sanitized, PDF scripting is disabled, server files are ephemeral, and PDF text-to-DOCX is experimental grade C.

- [ ] **Step 2: Record third-party licenses and exact versions**

Record PDF.js Apache-2.0, pdf-lib MIT, Mammoth BSD-2-Clause, jSquash Apache-2.0, Better Auth MIT, Fastify MIT, LibreOffice MPL-2.0, Pandoc GPL-2.0-or-later, OCRmyPDF MPL-2.0, Tesseract Apache-2.0, qpdf Apache-2.0, Poppler GPL-2.0-or-later, libvips LGPL-2.1-or-later, and ClamAV GPL-2.0.

- [ ] **Step 3: Run frozen quality gates**

Run:

~~~bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
git diff --check
~~~

Expected: every command exits 0.

- [ ] **Step 4: Assert package boundaries**

Run:

~~~bash
rg -n "better-sqlite3|node:child_process|node:net" apps/web packages/conversion-local
rg -n "https://(unpkg|cdn\\.jsdelivr|esm\\.sh)" apps packages
rg -n "enableScripting:\\s*true|isEvalSupported:\\s*true" apps packages
rg -n "shell:\\s*true|docker\\.sock" apps/worker
~~~

Expected: all four searches return no matches.

- [ ] **Step 5: Assert privacy field absence**

Run:

~~~bash
rg -n "sourceFilename|originalFilename|documentBody|contentHash|contentDigest" apps/api apps/worker packages/contracts
~~~

Expected: no matches outside tests that assert rejection.

- [ ] **Step 6: Request two-stage review**

Request a spec review against this plan, fix verified deviations, then request a separate code-quality and security review. Re-run the full gates after every accepted fix.

- [ ] **Step 7: Commit**

~~~bash
git add README.md THIRD_PARTY_NOTICES.md package.json pnpm-lock.yaml
git commit -m "docs: describe conversion privacy and quality"
~~~

## Execution pause before production

Do not create DNS records, OAuth credentials, server users, images, containers, Nginx files, certificates, or GitHub deployment secrets while executing this plan. Completion criteria are:

1. All local and API/worker tests pass.
2. Worker container artifacts can be built reproducibly by the companion release plan.
3. GitHub Pages build keeps server features disabled.
4. A production build enables server features only on \`opentrad.dynv6.net\`.
5. The production release plan can consume the committed contracts, images, migrations, and canary tests without renaming types.

## Self-review findings

- Spec coverage: PASS. Contracts, local conversions, PDF.js hardening, authentication, SQLite, API routes, consent, origin, idempotency, quotas, ClamAV admission, fixed worker policies, cancellation, TTL, account/server UI, bid assembly, E2E, and privacy verification each map to a numbered task.
- No-placeholders scan: PASS. The plan contains no deferred implementation markers, empty credential values, unspecified handlers, or generic “add tests” steps.
- Type consistency: PASS. \`ConversionCapability\`, \`CreateJobRequest\`, \`JobStatus\`, \`WorkerManifest\`, capability IDs, error codes, and lifecycle states retain the same names across contracts, API, worker, web, and E2E.
- Boundary consistency: PASS. Server-native modules never enter the web package; the worker receives no arbitrary command; Pages never invokes the server.
- Known execution constraint: Microsoft Word compatibility remains a release acceptance step because LibreOffice and Open XML checks cannot prove native Word behavior.
