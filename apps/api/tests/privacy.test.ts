import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITIES } from "@opentrad/contracts";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type ApiConfig, loadConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { ScannerError } from "../src/jobs/clamdClient.js";
import { runJobCleanup, startJobCleanup } from "../src/jobs/jobCleanup.js";
import { JobFiles } from "../src/jobs/jobFiles.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { buildServer, type ServerDependencies } from "../src/server.js";

const origin = "http://127.0.0.1";
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const databases: Database.Database[] = [];

interface TestRuntime {
  readonly app: FastifyInstance;
  readonly config: ApiConfig;
  readonly database: Database.Database;
  readonly files: JobFiles;
  readonly repository: JobRepository;
  readonly scannerCalls: { value: number };
  readonly scannerMode: { value: "clean" | "infected" | "unavailable" };
  readonly scannerOverride: {
    value?: (source: AsyncIterable<Uint8Array>, signal?: AbortSignal) => Promise<"clean">;
  };
  readonly logLines: string[];
  readonly owner: { value: string };
}

function config(): ApiConfig {
  const root = mkdtempSync(join(tmpdir(), "opentrad-task8-route-"));
  chmodSync(root, 0o700);
  roots.push(root);
  const databasePath = join(root, "opentrad.sqlite");
  applyMigrations(databasePath);
  return loadConfig({
    NODE_ENV: "test",
    OPENTRAD_PUBLIC_ORIGIN: origin,
    BETTER_AUTH_SECRET: "s".repeat(48),
    OPENTRAD_DATABASE_PATH: databasePath,
    OPENTRAD_JOB_ROOT: join(root, "jobs"),
    OPENTRAD_CLAMD_HOST: "127.0.0.1",
    OPENTRAD_CLAMD_PORT: "3310",
  });
}

async function runtime(): Promise<TestRuntime> {
  const testConfig = config();
  const database = new Database(testConfig.databasePath);
  databases.push(database);
  database.pragma("foreign_keys = ON");
  const files = new JobFiles(testConfig.jobRoot, { workerGid: process.getgid?.() ?? 0 });
  const repository = new JobRepository(database, {
    idempotencySecret: testConfig.betterAuthSecret,
  });
  const scannerCalls = { value: 0 };
  const scannerOverride: TestRuntime["scannerOverride"] = {};
  const scannerMode = { value: "clean" as const } as {
    value: "clean" | "infected" | "unavailable";
  };
  const owner = { value: randomUUID() };
  const logLines: string[] = [];
  const auth = {
    api: {
      getSession: async () => ({
        session: { id: randomUUID() },
        user: { id: owner.value },
      }),
      signUpEmail: async () => {
        throw new Error("unused");
      },
    },
    handler: async () => new Response("{}", { status: 404 }),
  };
  const dependencies = {
    auth,
    jobs: {
      files,
      repository,
      scanner: {
        scan: async (source: AsyncIterable<Uint8Array>, signal?: AbortSignal) => {
          scannerCalls.value += 1;
          if (scannerOverride.value) return scannerOverride.value(source, signal);
          for await (const _chunk of source) {
            // Consume with the production pull pipeline.
          }
          if (scannerMode.value === "infected") throw new ScannerError("MALWARE_DETECTED");
          if (scannerMode.value === "unavailable") {
            throw new ScannerError("SCANNER_UNAVAILABLE");
          }
          return "clean" as const;
        },
      },
    },
    logStream: {
      write(line: string): void {
        logLines.push(line);
      },
    },
  } satisfies ServerDependencies;
  const app = await buildServer(testConfig, dependencies);
  apps.push(app);
  return {
    app,
    config: testConfig,
    database,
    files,
    logLines,
    owner,
    repository,
    scannerCalls,
    scannerMode,
    scannerOverride,
  };
}

const privatePayload = "{\\rtf1 PRIVATE_BODY_SENTINEL}";
const requestMetadata = {
  inputBytes: Buffer.byteLength(privatePayload),
  inputFormat: "rtf",
  operation: "office.to.pdf",
  options: {},
  outputFormat: "pdf",
} as const;

function headers(key = "privacy-idempotency-key-0001") {
  return {
    host: "127.0.0.1",
    origin,
    "sec-fetch-site": "same-origin",
    "x-opentrad-job-request": JSON.stringify(requestMetadata),
    "x-opentrad-processing-consent": "server-v1",
    "idempotency-key": key,
  };
}

function multipart(
  boundary: string,
  body: string,
  filename = "private-source.rtf",
  mediaType = "application/rtf",
): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n${body}\r\n--${boundary}--\r\n`;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("job HTTP admission and privacy", () => {
  it("returns the exact frozen capability matrix publicly", async () => {
    const { app } = await runtime();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities",
      headers: { host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ capabilities: CAPABILITIES });
  });

  it("logs request completion with only a fixed event and code", async () => {
    const { app, logLines } = await runtime();
    const sentinel = "PRIVATE_LOG_METADATA_SENTINEL";
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities",
      headers: {
        authorization: sentinel,
        cookie: sentinel,
        host: "127.0.0.1",
        "x-opentrad-job-request": sentinel,
      },
    });
    expect(response.statusCode).toBe(200);
    const records = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const completion = records.find((record) => record.msg === "request_complete");
    expect(completion).toBeDefined();
    expect(completion).toMatchObject({ event: "request_complete", code: "REQUEST_COMPLETE" });
    expect(completion).not.toHaveProperty("method");
    expect(completion).not.toHaveProperty("statusCode");
    const businessKeys = Object.keys(completion ?? {}).filter(
      (key) =>
        key !== "hostname" && key !== "level" && key !== "msg" && key !== "pid" && key !== "time",
    );
    expect(businessKeys.sort()).toEqual(["code", "event"]);
    expect(JSON.stringify(records)).not.toContain(sentinel);
  });

  it("rejects missing consent over a real slow HTTP body before reading bytes or scanning", async () => {
    const { app, config: testConfig, scannerCalls } = await runtime();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    const boundary = "slow-boundary";
    const { "x-opentrad-processing-consent": _omittedConsent, ...headersWithoutConsent } = headers(
      "slow-idempotency-key-0001",
    );
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/api/v1/jobs",
        headers: {
          ...headersWithoutConsent,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": 1_000_000,
        },
      });
      request.on("response", (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          request.destroy();
          resolve({ body, status: response.statusCode ?? 0 });
        });
      });
      request.on("error", reject);
      request.flushHeaders();
    });

    expect(result).toEqual({
      body: '{"error":{"code":"PROCESSING_CONSENT_REQUIRED"}}',
      status: 403,
    });
    expect(scannerCalls.value).toBe(0);
    expect(await readdir(join(testConfig.jobRoot, "staging"))).toEqual([]);
  });

  it("admits one file, replays without parsing, and keeps sentinels out of metadata", async () => {
    const { app, config: testConfig, database, logLines, scannerCalls } = await runtime();
    const boundary = "privacy-boundary";
    const privateBody = privatePayload;
    const privateName = "PRIVATE_FILENAME_SENTINEL.docx";
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart(boundary, privateBody, privateName),
    });
    expect(first.statusCode).toBe(202);
    const jobId = first.json().job.id as string;
    expect(scannerCalls.value).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers(),
        "content-type": `multipart/form-data; boundary=unused-boundary`,
      },
      payload: "body-must-not-be-read",
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().job.id).toBe(jobId);
    expect(scannerCalls.value).toBe(1);

    const rows = database
      .prepare("SELECT * FROM jobs JOIN idempotency ON jobs.id=idempotency.job_id")
      .all();
    const stored = JSON.stringify(rows);
    const manifest = readFileSync(
      join(testConfig.jobRoot, "queued", jobId, "manifest.json"),
      "utf8",
    );
    const privateSurfaces = `${stored}${manifest}${first.body}${replay.body}${logLines.join("\n")}`;
    expect(privateSurfaces).not.toContain(privateName);
    expect(privateSurfaces).not.toContain(privateBody);
    expect(privateSurfaces).not.toContain("privacy-idempotency-key-0001");
    expect(privateSurfaces).not.toContain("x-opentrad-job-request");
  });

  it("removes expired database reservations and queued files before a new admission", async () => {
    const testRuntime = await runtime();
    const firstBoundary = "ttl-first";
    const first = await testRuntime.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers("ttl-first-idempotency-key-0001"),
        "content-type": `multipart/form-data; boundary=${firstBoundary}`,
      },
      payload: multipart(firstBoundary, privatePayload),
    });
    expect(first.statusCode).toBe(202);
    const expiredId = first.json().job.id as string;
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=1, expires_at=2 WHERE id=?")
      .run(expiredId);
    testRuntime.database
      .prepare("UPDATE idempotency SET expires_at=2 WHERE job_id=?")
      .run(expiredId);
    testRuntime.owner.value = randomUUID();
    const nextBoundary = "ttl-next";
    const next = await testRuntime.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers("ttl-next-idempotency-key-0001"),
        "content-type": `multipart/form-data; boundary=${nextBoundary}`,
      },
      payload: multipart(nextBoundary, privatePayload),
    });
    expect(next.statusCode).toBe(202);
    expect(testRuntime.repository.findOwnedJob(testRuntime.owner.value, expiredId)).toBeUndefined();
    expect(await testRuntime.files.exists(expiredId)).toBe(false);
  });

  it("conflicts on changed shape before reading a multipart body", async () => {
    const { app, scannerCalls } = await runtime();
    const boundary = "conflict-boundary";
    const firstBody = privatePayload;
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { ...headers(), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, firstBody),
    });
    expect(first.statusCode).toBe(202);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers(),
        "content-type": "multipart/form-data; boundary=unused",
        "x-opentrad-job-request": JSON.stringify({ ...requestMetadata, inputBytes: 22 }),
      },
      payload: "not-a-multipart-body",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(scannerCalls.value).toBe(1);
  });

  it.each([
    ["infected", 422, "MALWARE_DETECTED"],
    ["unavailable", 503, "SCANNER_UNAVAILABLE"],
  ] as const)("rolls back every reservation when scanner is %s", async (mode, status, code) => {
    const testRuntime = await runtime();
    testRuntime.scannerMode.value = mode;
    const boundary = `scanner-${mode}`;
    const response = await testRuntime.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers(`scanner-${mode}-idempotency-key-0001`),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart(boundary, privatePayload),
    });
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    for (const table of ["jobs", "idempotency", "daily_usage"] as const) {
      expect(
        testRuntime.database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
        table,
      ).toEqual({ count: 0 });
    }
    expect(await readdir(join(testRuntime.config.jobRoot, "staging"))).toEqual([]);
    expect(await readdir(join(testRuntime.config.jobRoot, "queued"))).toEqual([]);
  });

  it("rolls back declared-byte mismatch, magic mismatch, fields, and multiple files", async () => {
    for (const invalidCase of ["bytes", "magic", "field", "multiple"] as const) {
      const testRuntime = await runtime();
      const boundary = `invalid-${invalidCase}`;
      const metadata = {
        ...requestMetadata,
        ...(invalidCase === "bytes" ? { inputBytes: requestMetadata.inputBytes + 1 } : {}),
      };
      const payload =
        invalidCase === "field"
          ? `--${boundary}\r\nContent-Disposition: form-data; name="unknown"\r\n\r\nx\r\n--${boundary}--\r\n`
          : invalidCase === "multiple"
            ? `${multipart(boundary, privatePayload).replace(`--${boundary}--\r\n`, "")}` +
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.rtf"\r\n\r\nx\r\n--${boundary}--\r\n`
            : multipart(
                boundary,
                invalidCase === "magic" ? "x".repeat(requestMetadata.inputBytes) : privatePayload,
              );
      const response = await testRuntime.app.inject({
        method: "POST",
        url: "/api/v1/jobs",
        headers: {
          ...headers(`invalid-${invalidCase}-idempotency-key-0001`),
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "x-opentrad-job-request": JSON.stringify(metadata),
        },
        payload,
      });
      expect(response.statusCode, invalidCase).toBe(400);
      expect(response.json(), invalidCase).toEqual({ error: { code: "INVALID_REQUEST" } });
      expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
        count: 0,
      });
      await testRuntime.app.close();
      apps.splice(apps.indexOf(testRuntime.app), 1);
      testRuntime.database.close();
      databases.splice(databases.indexOf(testRuntime.database), 1);
    }
  });

  it("rolls back reservation and staging after a real multipart client abort", async () => {
    const testRuntime = await runtime();
    await testRuntime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = testRuntime.app.server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    const boundary = "upload-abort-boundary";
    await new Promise<void>((resolve) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/api/v1/jobs",
        headers: {
          ...headers("upload-abort-idempotency-key-0001"),
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": 1_000_000,
        },
      });
      request.on("error", () => resolve());
      request.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="private.rtf"\r\nContent-Type: application/rtf\r\n\r\n{\\rtf1 `,
      );
      setTimeout(() => {
        request.destroy();
        resolve();
      }, 5);
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const count = testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get() as {
        count: number;
      };
      if (count.count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
    expect(await readdir(join(testRuntime.config.jobRoot, "staging"))).toEqual([]);
    expect(await readdir(join(testRuntime.config.jobRoot, "queued"))).toEqual([]);
  });

  it("aborts a slow scanner after the client closes post-upload and refunds every reservation", async () => {
    const testRuntime = await runtime();
    let scannerFinishedUpload: (() => void) | undefined;
    const uploadFinished = new Promise<void>((resolve) => {
      scannerFinishedUpload = resolve;
    });
    let observedAbort = false;
    testRuntime.scannerOverride.value = async (source, signal) => {
      for await (const _chunk of source) {
        // Consume through the final ClamAV-equivalent frame.
      }
      scannerFinishedUpload?.();
      observedAbort = await new Promise<boolean>((resolve) => {
        if (signal?.aborted) {
          resolve(true);
          return;
        }
        const timeout = setTimeout(() => resolve(false), 200);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true },
        );
      });
      throw new ScannerError("SCANNER_UNAVAILABLE");
    };
    await testRuntime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = testRuntime.app.server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    const boundary = "post-upload-abort-boundary";
    const payload = multipart(boundary, privatePayload, "private.rtf");
    const request = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/api/v1/jobs",
      headers: {
        ...headers("post-upload-abort-idempotency-key-0001"),
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": Buffer.byteLength(payload),
      },
    });
    request.on("error", () => undefined);
    request.end(payload);
    await uploadFinished;
    request.destroy();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const count = testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get() as {
        count: number;
      };
      if (count.count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(observedAbort).toBe(true);
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM idempotency").get()).toEqual(
      { count: 0 },
    );
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM daily_usage").get()).toEqual(
      { count: 0 },
    );
    expect(await readdir(join(testRuntime.config.jobRoot, "staging"))).toEqual([]);
  });

  it.each(["application/x-private", "application/pdf"])(
    "rejects part MIME %s before the first file byte is required",
    async (partMime) => {
      const testRuntime = await runtime();
      await testRuntime.app.listen({ host: "127.0.0.1", port: 0 });
      const address = testRuntime.app.server.address();
      if (address === null || typeof address === "string") throw new Error("listen failed");
      const boundary = `mime-${partMime.endsWith("pdf") ? "mismatch" : "unknown"}`;
      const result = await new Promise<{ body: string; status: number }>((resolve) => {
        const request = httpRequest({
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/api/v1/jobs",
          headers: {
            ...headers(`mime-${boundary}-idempotency-key-0001`),
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "content-length": 1_000_000,
          },
        });
        const timeout = setTimeout(() => {
          request.destroy();
          resolve({ body: "", status: 0 });
        }, 2_000);
        request.on("response", (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            clearTimeout(timeout);
            request.destroy();
            resolve({ body, status: response.statusCode ?? 0 });
          });
        });
        request.on("error", () => undefined);
        request.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="private.rtf"\r\nContent-Type: ${partMime}\r\n\r\nX`,
        );
      });

      expect(result).toEqual({ body: '{"error":{"code":"INVALID_REQUEST"}}', status: 415 });
      expect(testRuntime.scannerCalls.value).toBe(0);
      expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
        count: 0,
      });
      expect(await readdir(join(testRuntime.config.jobRoot, "staging"))).toEqual([]);
    },
  );

  it("accepts only the exact declared-format part MIME and rejects octet-stream", async () => {
    const accepted = await runtime();
    const acceptedBoundary = "accepted-exact-rtf";
    const acceptedResponse = await accepted.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers("accepted-exact-rtf-idempotency-key-0001"),
        "content-type": `multipart/form-data; boundary=${acceptedBoundary}`,
      },
      payload: multipart(acceptedBoundary, privatePayload),
    });
    expect(acceptedResponse.statusCode).toBe(202);

    const rejected = await runtime();
    const rejectedBoundary = "rejected-octet-stream";
    const rejectedResponse = await rejected.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers("rejected-octet-stream-idempotency-key-0001"),
        "content-type": `multipart/form-data; boundary=${rejectedBoundary}`,
      },
      payload: multipart(
        rejectedBoundary,
        privatePayload,
        "private.rtf",
        "application/octet-stream",
      ),
    });
    expect(rejectedResponse.statusCode).toBe(415);
    expect(rejectedResponse.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(rejected.scannerCalls.value).toBe(0);
    expect(rejected.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
  });
});

describe("owned job lifecycle and one-shot result", () => {
  async function admitted(testRuntime: TestRuntime, key: string): Promise<string> {
    const boundary = `boundary-${key.slice(-4)}`;
    const response = await testRuntime.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { ...headers(key), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, privatePayload),
    });
    expect(response.statusCode).toBe(202);
    return response.json().job.id as string;
  }

  it("cleans expired jobs without a new POST and retries a failed file deletion on the next tick", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "scheduled-expiry-idempotency-key-0001");
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
      .run(jobId);
    testRuntime.database.prepare("UPDATE idempotency SET expires_at=1 WHERE job_id=?").run(jobId);
    const destroy = JobFiles.prototype.destroy.bind(testRuntime.files);
    let attempts = 0;
    Object.defineProperty(testRuntime.files, "destroy", {
      configurable: true,
      value: async (id: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error("injected-delete-failure");
        await destroy(id);
      },
    });

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });
    expect(
      testRuntime.database.prepare("SELECT cleanup_kind, cleanup_token FROM jobs").get(),
    ).toEqual({ cleanup_kind: "expiry", cleanup_token: null });
    expect(await testRuntime.files.exists(jobId)).toBe(true);

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
    expect(await testRuntime.files.exists(jobId)).toBe(false);
  });

  it("expires an API-private succeeded result only after deleting its files", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "succeeded-expiry-idempotency-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    expect(
      testRuntime.repository.markTerminal(jobId, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(true);
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
      .run(jobId);
    testRuntime.database.prepare("UPDATE idempotency SET expires_at=1 WHERE job_id=?").run(jobId);
    const destroy = JobFiles.prototype.destroy.bind(testRuntime.files);
    let attempts = 0;
    Object.defineProperty(testRuntime.files, "destroy", {
      configurable: true,
      value: async (id: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error("terminal-expiry-delete-failure");
        await destroy(id);
      },
    });

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });

    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 1,
    });
    expect(await testRuntime.files.exists(jobId)).toBe(true);
    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });

    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
    expect(await testRuntime.files.exists(jobId)).toBe(false);
  });

  it.each(["failed", "cancelled"] as const)(
    "expires a file-free terminal %s row",
    async (status) => {
      const testRuntime = await runtime();
      const jobId = await admitted(testRuntime, `${status}-expiry-idempotency-key-0001`);
      await testRuntime.files.destroy(jobId);
      expect(
        status === "failed"
          ? testRuntime.repository.markTerminal(jobId, status, {
              errorCode: "CONVERSION_FAILED",
              retryable: false,
            })
          : testRuntime.repository.markTerminal(jobId, status),
      ).toBe(true);
      testRuntime.database
        .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
        .run(jobId);
      testRuntime.database.prepare("UPDATE idempotency SET expires_at=1 WHERE job_id=?").run(jobId);

      await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });

      expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
        count: 0,
      });
      expect(await testRuntime.files.exists(jobId)).toBe(false);
    },
  );

  it("marks an expired running job cancelled before publishing its control marker", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "running-expiry-idempotency-key-0001");
    renameSync(
      testRuntime.files.queuedDirectory(jobId),
      join(testRuntime.config.jobRoot, "running", jobId),
    );
    expect(testRuntime.repository.markRunning(jobId)).toBe(true);
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
      .run(jobId);

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });

    expect(
      testRuntime.database
        .prepare(
          "SELECT status, cancel_requested, cleanup_kind, cleanup_token FROM jobs WHERE id=?",
        )
        .get(jobId),
    ).toEqual({
      cancel_requested: 1,
      cleanup_kind: "expiry",
      cleanup_token: null,
      status: "cancelling",
    });
    expect(await readdir(join(testRuntime.config.jobRoot, "control"))).toEqual([`${jobId}.cancel`]);
    expect(await testRuntime.files.exists(jobId)).toBe(true);
  });

  it("atomically expires an outbox completion without publishing a private result", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "outbox-expiry-idempotency-key-0001");
    const running = join(testRuntime.config.jobRoot, "running", jobId);
    renameSync(testRuntime.files.queuedDirectory(jobId), running);
    expect(testRuntime.repository.markRunning(jobId)).toBe(true);
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    renameSync(running, testRuntime.files.outboxDirectory(jobId));
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
      .run(jobId);

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });

    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
    expect(await testRuntime.files.exists(jobId)).toBe(false);
  });

  it("runs cleanup immediately, installs one bounded interval, and clears it on stop", async () => {
    const testRuntime = await runtime();
    let callback: (() => void) | undefined;
    const timer = { id: 1 } as unknown as NodeJS.Timeout;
    const cleared: NodeJS.Timeout[] = [];
    const controller = await startJobCleanup(
      { files: testRuntime.files, repository: testRuntime.repository },
      {
        clearInterval: (value) => cleared.push(value),
        intervalMs: 1_000,
        setInterval: (run, milliseconds) => {
          expect(milliseconds).toBe(1_000);
          callback = run;
          return timer;
        },
      },
    );
    expect(callback).toBeTypeOf("function");
    callback?.();
    await controller.idle();
    controller.stop();
    expect(cleared).toEqual([timer]);
  });

  it.each(["status", "result"] as const)(
    "runs expired cleanup when the owner touches %s without another POST",
    async (surface) => {
      const testRuntime = await runtime();
      const jobId = await admitted(testRuntime, `touch-${surface}-expiry-idempotency-key-0001`);
      testRuntime.database
        .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
        .run(jobId);
      testRuntime.database.prepare("UPDATE idempotency SET expires_at=1 WHERE job_id=?").run(jobId);
      const response = await testRuntime.app.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}${surface === "result" ? "/result" : ""}`,
        headers: { host: "127.0.0.1" },
      });

      expect(response.statusCode).toBe(404);
      expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
        count: 0,
      });
      expect(await testRuntime.files.exists(jobId)).toBe(false);
    },
  );

  it("isolates status and cancellation by owner and removes queued files", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "cancel-idempotency-key-0001");
    testRuntime.owner.value = randomUUID();
    const hidden = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1" },
    });
    expect(hidden.statusCode).toBe(404);

    const secondOwner = testRuntime.owner.value;
    testRuntime.owner.value = (
      testRuntime.database.prepare("SELECT owner_id FROM jobs WHERE id=?").get(jobId) as {
        owner_id: string;
      }
    ).owner_id;
    const cancelled = await testRuntime.app.inject({
      method: "DELETE",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe("cancelled");
    for (let attempt = 0; attempt < 20 && (await testRuntime.files.exists(jobId)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await testRuntime.files.exists(jobId)).toBe(false);
    testRuntime.owner.value = secondOwner;
  });

  it("keeps cancellation pending until deletion succeeds and retries it durably", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "durable-cancel-idempotency-key-0001");
    const destroy = JobFiles.prototype.destroy.bind(testRuntime.files);
    let attempts = 0;
    Object.defineProperty(testRuntime.files, "destroy", {
      configurable: true,
      value: async (id: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error("private-delete-failure");
        await destroy(id);
      },
    });

    const first = await testRuntime.app.inject({
      method: "DELETE",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
    });
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(
      testRuntime.database
        .prepare("SELECT status, cleanup_kind, cleanup_token FROM jobs WHERE id=?")
        .get(jobId),
    ).toEqual({ status: "cancelling", cleanup_kind: "cancel", cleanup_token: null });
    expect(await testRuntime.files.exists(jobId)).toBe(true);

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });
    expect(
      testRuntime.database
        .prepare("SELECT status, cleanup_kind, cleanup_token FROM jobs WHERE id=?")
        .get(jobId),
    ).toEqual({ status: "cancelled", cleanup_kind: null, cleanup_token: null });
    expect(await testRuntime.files.exists(jobId)).toBe(false);
  });

  it("persists running cancellation in DB before publishing a worker control marker", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "running-cancel-control-idempotency-key-0001");
    renameSync(
      testRuntime.files.queuedDirectory(jobId),
      join(testRuntime.config.jobRoot, "running", jobId),
    );
    expect(testRuntime.repository.markRunning(jobId)).toBe(true);

    const response = await testRuntime.app.inject({
      method: "DELETE",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().job.status).toBe("cancelling");
    expect(
      testRuntime.database
        .prepare("SELECT status, cancel_requested FROM jobs WHERE id=?")
        .get(jobId),
    ).toEqual({ cancel_requested: 1, status: "cancelling" });
    expect(await readdir(join(testRuntime.config.jobRoot, "control"))).toEqual([`${jobId}.cancel`]);
    expect(await readdir(join(testRuntime.config.jobRoot, "running", jobId))).toEqual([
      "input.bin",
      "manifest.json",
    ]);
  });

  it("does not delete a filesystem-claimed job before DB running reconciliation", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "claim-cancel-race-idempotency-key-0001");
    renameSync(
      testRuntime.files.queuedDirectory(jobId),
      join(testRuntime.config.jobRoot, "running", jobId),
    );

    const response = await testRuntime.app.inject({
      method: "DELETE",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().job.status).toBe("cancelling");
    expect(
      testRuntime.database
        .prepare("SELECT status, cancel_requested, cleanup_kind FROM jobs WHERE id=?")
        .get(jobId),
    ).toEqual({ cancel_requested: 1, cleanup_kind: null, status: "cancelling" });
    expect(await readdir(join(testRuntime.config.jobRoot, "running", jobId))).toEqual([
      "input.bin",
      "manifest.json",
    ]);
    expect(await readdir(join(testRuntime.config.jobRoot, "control"))).toEqual([`${jobId}.cancel`]);
  });

  it("HEAD and Range do not consume, while concurrent GET claims only once", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "result-idempotency-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    expect(
      testRuntime.repository.markTerminal(jobId, "succeeded", {
        mediaType: "application/pdf",
        resultBytes: 4,
      }),
    ).toBe(true);
    testRuntime.database
      .prepare("UPDATE jobs SET created_at=? WHERE id=?")
      .run(Date.UTC(2025, 0, 2), jobId);

    const rangedHead = await testRuntime.app.inject({
      method: "HEAD",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1", range: "bytes=0-1" },
    });
    expect(rangedHead.statusCode).toBe(416);
    expect(rangedHead.body).toBe("");

    const head = await testRuntime.app.inject({
      method: "HEAD",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["cache-control"]).toBe("no-store");
    expect(head.headers["accept-ranges"]).toBe("none");
    expect(head.headers["content-disposition"]).toBe(
      'attachment; filename="opentrad-office-to-pdf-2025-01-02.pdf"',
    );

    const range = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1", range: "bytes=0-1" },
    });
    expect(range.statusCode).toBe(416);
    expect(range.json()).toEqual({ error: { code: "INVALID_REQUEST" } });

    const downloads = await Promise.all([
      testRuntime.app.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}/result`,
        headers: { host: "127.0.0.1" },
      }),
      testRuntime.app.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}/result`,
        headers: { host: "127.0.0.1" },
      }),
    ]);
    expect(downloads.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(downloads.find((response) => response.statusCode === 200)?.body).toBe("PDF!");
    for (let attempt = 0; attempt < 20 && (await testRuntime.files.exists(jobId)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await testRuntime.files.exists(jobId)).toBe(false);

    const repeated = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(repeated.statusCode).toBe(404);
  });

  it("streams a result from the same no-follow handle even if its path is swapped", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "result-toctou-idempotency-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    testRuntime.repository.markTerminal(jobId, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });

    const resultPath = testRuntime.files.resultPath(jobId);
    const originalPath = join(resultPath.slice(0, resultPath.lastIndexOf("/")), "original.bin");
    const sentinelPath = join(testRuntime.config.jobRoot, "private-result-sentinel");
    writeFileSync(sentinelPath, "PRIVATE_RESULT_SENTINEL", { mode: 0o600 });
    let swapped = false;
    const swapPath = () => {
      if (swapped) return;
      swapped = true;
      renameSync(resultPath, originalPath);
      symlinkSync(sentinelPath, resultPath);
    };
    const filesWithAtomicOpen = testRuntime.files as JobFiles & {
      openResult?: (id: string) => Promise<unknown>;
    };
    if (typeof filesWithAtomicOpen.openResult === "function") {
      const originalOpen = filesWithAtomicOpen.openResult.bind(testRuntime.files);
      Object.defineProperty(testRuntime.files, "openResult", {
        configurable: true,
        value: async (id: string) => {
          const opened = await originalOpen(id);
          swapPath();
          return opened;
        },
      });
    } else {
      const originalSize = testRuntime.files.resultSize.bind(testRuntime.files);
      Object.defineProperty(testRuntime.files, "resultSize", {
        configurable: true,
        value: async (id: string) => {
          const size = await originalSize(id);
          swapPath();
          return size;
        },
      });
    }

    const response = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(swapped).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("PDF!");
    expect(response.body).not.toContain("SENTINEL");
  });

  it("does not let a distinct shared-gid worker replace the intermediate done directory", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "result-directory-symlink-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    testRuntime.repository.markTerminal(jobId, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });

    const doneParent = join(testRuntime.config.jobRoot, "done");
    const doneInfo = statSync(doneParent);
    const workerUid = doneInfo.uid + 10_000;
    const shift =
      workerUid === doneInfo.uid ? 6 : doneInfo.gid === (process.getgid?.() ?? 0) ? 3 : 0;
    const workerCanReplace = ((doneInfo.mode >> shift) & 0o3) === 0o3;
    if (workerCanReplace) {
      const original = join(doneParent, `${jobId}-original`);
      const sentinelDirectory = join(
        testRuntime.config.jobRoot,
        "PRIVATE_RESULT_DIRECTORY_SENTINEL",
      );
      mkdirSync(sentinelDirectory, { mode: 0o700 });
      writeFileSync(join(sentinelDirectory, "result.bin"), "PWN!", { mode: 0o600 });
      renameSync(join(doneParent, jobId), original);
      symlinkSync(sentinelDirectory, join(doneParent, jobId));
    }

    const response = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("PDF!");
    expect(response.body).not.toContain("PWN");
    expect(workerCanReplace).toBe(false);
  });

  it("rejects a consumed idempotency replay before multipart consumption or new quota", async () => {
    const testRuntime = await runtime();
    const key = "consumed-replay-idempotency-key-0001";
    const jobId = await admitted(testRuntime, key);
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    testRuntime.repository.markTerminal(jobId, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });
    const download = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(download.statusCode).toBe(200);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = testRuntime.database
        .prepare("SELECT result_consumed FROM jobs WHERE id=?")
        .get(jobId) as { result_consumed: number };
      if (row.result_consumed === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(
      testRuntime.database.prepare("SELECT result_consumed FROM jobs WHERE id=?").get(jobId),
    ).toEqual({ result_consumed: 1 });
    const scannerCalls = testRuntime.scannerCalls.value;

    const replay = await testRuntime.app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: {
        ...headers(key),
        "content-type": "multipart/form-data; boundary=must-not-be-consumed",
      },
      payload: "PRIVATE_REPLAY_BODY_SENTINEL",
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({ error: { code: "JOB_NOT_READY" } });
    expect(testRuntime.scannerCalls.value).toBe(scannerCalls);
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 1,
    });
    expect(testRuntime.database.prepare("SELECT accepted_count FROM daily_usage").get()).toEqual({
      accepted_count: 1,
    });
  });

  it("releases a result claim after a real client abort and preserves retry", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "abort-result-idempotency-key-0001");
    const resultBytes = 16 * 1024 * 1024;
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes,
      source: (async function* () {
        for (let offset = 0; offset < resultBytes; offset += 64 * 1024) {
          yield Buffer.alloc(64 * 1024, 0x50);
        }
      })(),
    });
    expect(
      testRuntime.repository.markTerminal(jobId, "succeeded", {
        mediaType: "application/pdf",
        resultBytes,
      }),
    ).toBe(true);
    await testRuntime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = testRuntime.app.server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: `/api/v1/jobs/${jobId}/result`,
        headers: { host: "127.0.0.1" },
      });
      request.on("response", (response) => {
        response.once("data", () => {
          response.destroy();
          request.destroy();
          resolve();
        });
      });
      request.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
        else reject(error);
      });
      request.end();
    });
    let row: { result_claim_token: string | null; result_consumed: number } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      row = testRuntime.database
        .prepare("SELECT result_claim_token, result_consumed FROM jobs WHERE id=?")
        .get(jobId) as typeof row;
      if (row?.result_claim_token === null) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(row).toEqual({ result_claim_token: null, result_consumed: 0 });
    expect(await testRuntime.files.exists(jobId)).toBe(true);

    const retry = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.rawPayload.byteLength).toBe(resultBytes);
  });

  it("keeps a completed download visible until durable result deletion succeeds", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "durable-download-idempotency-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    testRuntime.repository.markTerminal(jobId, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });
    const destroy = JobFiles.prototype.destroy.bind(testRuntime.files);
    let attempts = 0;
    Object.defineProperty(testRuntime.files, "destroy", {
      configurable: true,
      value: async (id: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error("private-result-delete-failure");
        await destroy(id);
      },
    });

    const response = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("PDF!");
    let pendingCleanup:
      | { cleanup_kind: string | null; cleanup_token: string | null; result_consumed: number }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      pendingCleanup = testRuntime.database
        .prepare("SELECT result_consumed, cleanup_kind, cleanup_token FROM jobs WHERE id=?")
        .get(jobId) as typeof pendingCleanup;
      if (pendingCleanup?.cleanup_kind === "consume" && pendingCleanup.cleanup_token === null)
        break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(pendingCleanup).toEqual({
      result_consumed: 0,
      cleanup_kind: "consume",
      cleanup_token: null,
    });
    expect(await testRuntime.files.exists(jobId)).toBe(true);

    await runJobCleanup({ files: testRuntime.files, repository: testRuntime.repository });
    expect(
      testRuntime.database.prepare("SELECT result_consumed FROM jobs WHERE id=?").get(jobId),
    ).toEqual({ result_consumed: 1 });
    expect(await testRuntime.files.exists(jobId)).toBe(false);
    const hidden = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}`,
      headers: { host: "127.0.0.1" },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("preserves result files when the atomic cleanup step refuses the claim", async () => {
    const testRuntime = await runtime();
    const jobId = await admitted(testRuntime, "consume-refusal-idempotency-key-0001");
    await testRuntime.files.promoteResult({
      jobId,
      resultBytes: 4,
      source: (async function* () {
        yield Buffer.from("PDF!");
      })(),
    });
    testRuntime.repository.markTerminal(jobId, "succeeded", {
      mediaType: "application/pdf",
      resultBytes: 4,
    });
    Object.defineProperty(testRuntime.repository, "beginResultCleanup", {
      configurable: true,
      value: () => undefined,
    });
    const response = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}/result`,
      headers: { host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(200);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = testRuntime.database
        .prepare("SELECT result_claim_token FROM jobs WHERE id=?")
        .get(jobId) as { result_claim_token: string | null };
      if (row.result_claim_token === null) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await testRuntime.files.exists(jobId)).toBe(true);
    expect(
      testRuntime.database.prepare("SELECT result_claim_token FROM jobs WHERE id=?").get(jobId),
    ).toEqual({ result_claim_token: null });
  });

  it("returns fixed OPTIONS and unsupported-method responses for every jobs surface", async () => {
    const testRuntime = await runtime();
    for (const url of [
      "/api/v1/jobs",
      `/api/v1/jobs/${randomUUID()}`,
      `/api/v1/jobs/${randomUUID()}/result`,
    ]) {
      const response = await testRuntime.app.inject({
        method: "OPTIONS",
        url,
        headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
      });
      expect(response.statusCode, url).toBe(204);
      expect(response.body, url).toBe("");
    }
    const wrong = await testRuntime.app.inject({
      method: "PUT",
      url: "/api/v1/jobs",
      headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
    });
    expect(wrong.statusCode).toBe(405);
    expect(wrong.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  });

  it("rate-limits admission and polling in separate owner/IP buckets", async () => {
    const testRuntime = await runtime();
    const missingJob = randomUUID();
    const pollStatuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      const response = await testRuntime.app.inject({
        method: "GET",
        url: `/api/v1/jobs/${missingJob}`,
        headers: { host: "127.0.0.1" },
        remoteAddress: "198.51.100.40",
      });
      pollStatuses.push(response.statusCode);
    }
    expect(pollStatuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    expect(pollStatuses[60]).toBe(429);

    testRuntime.owner.value = randomUUID();
    const otherOwner = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${missingJob}`,
      headers: { host: "127.0.0.1" },
      remoteAddress: "198.51.100.40",
    });
    expect(otherOwner.statusCode).toBe(404);
    const otherIp = await testRuntime.app.inject({
      method: "GET",
      url: `/api/v1/jobs/${missingJob}`,
      headers: { host: "127.0.0.1" },
      remoteAddress: "198.51.100.41",
    });
    expect(otherIp.statusCode).toBe(404);

    const admissionStatuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await testRuntime.app.inject({
        method: "POST",
        url: "/api/v1/jobs",
        headers: { host: "127.0.0.1", origin, "sec-fetch-site": "same-origin" },
        remoteAddress: "198.51.100.50",
      });
      admissionStatuses.push(response.statusCode);
    }
    expect(admissionStatuses.slice(0, 10).every((status) => status === 403)).toBe(true);
    expect(admissionStatuses[10]).toBe(429);
    expect(testRuntime.scannerCalls.value).toBe(0);
    expect(testRuntime.database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({
      count: 0,
    });
  });
});

describe("startup ownership cleanup", () => {
  it("reconciles a crash-persisted worker outbox before server readiness", async () => {
    const testConfig = config();
    const database = new Database(testConfig.databasePath);
    databases.push(database);
    database.pragma("foreign_keys = ON");
    const files = new JobFiles(testConfig.jobRoot, { workerGid: process.getgid?.() ?? 0 });
    const repository = new JobRepository(database, {
      idempotencySecret: testConfig.betterAuthSecret,
    });
    const reservation = repository.reserveAdmission({
      idempotencyKey: "startup-reconcile-idempotency-key-0001",
      ownerId: randomUUID(),
      request: requestMetadata,
    });
    await files.stageAndQueue({
      declaredBytes: Buffer.byteLength(privatePayload),
      jobId: reservation.job.id,
      request: requestMetadata,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the production pipeline.
        }
        return "clean";
      },
      source: (async function* () {
        yield Buffer.from(privatePayload);
      })(),
    });
    repository.markQueued(reservation.job.id);
    const running = join(testConfig.jobRoot, "running", reservation.job.id);
    renameSync(files.queuedDirectory(reservation.job.id), running);
    expect(repository.markRunning(reservation.job.id)).toBe(true);
    writeFileSync(join(running, "result.bin"), "%PDF", { mode: 0o640 });
    writeFileSync(
      join(running, "status.json"),
      `${JSON.stringify({
        mediaType: "application/pdf",
        resultBytes: 4,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      })}\n`,
      { mode: 0o640 },
    );
    renameSync(running, files.outboxDirectory(reservation.job.id));
    const auth = {
      api: {
        getSession: async () => null,
        signUpEmail: async () => {
          throw new Error("unused");
        },
      },
      handler: async () => new Response("{}", { status: 404 }),
    };

    const app = await buildServer(testConfig, {
      auth,
      jobs: { files, repository, scanner: { scan: async () => "clean" as const } },
    });
    apps.push(app);

    expect(repository.workerJobState(reservation.job.id)).toBeUndefined();
    expect(readFileSync(files.resultPath(reservation.job.id), "utf8")).toBe("%PDF");
  });

  it("runs durable job cleanup before server readiness", async () => {
    const testConfig = config();
    const database = new Database(testConfig.databasePath);
    databases.push(database);
    database.pragma("foreign_keys = ON");
    const files = new JobFiles(testConfig.jobRoot, { workerGid: process.getgid?.() ?? 0 });
    const repository = new JobRepository(database, {
      idempotencySecret: testConfig.betterAuthSecret,
    });
    const ownerId = randomUUID();
    const reservation = repository.reserveAdmission({
      idempotencyKey: "startup-cleanup-idempotency-key-0001",
      ownerId,
      request: requestMetadata,
    });
    await files.stageAndQueue({
      declaredBytes: Buffer.byteLength(privatePayload),
      jobId: reservation.job.id,
      request: requestMetadata,
      scan: async (source) => {
        for await (const _chunk of source) {
          // Consume the production pipeline.
        }
        return "clean";
      },
      source: (async function* () {
        yield Buffer.from(privatePayload);
      })(),
    });
    repository.markQueued(reservation.job.id);
    database
      .prepare("UPDATE jobs SET created_at=0, expires_at=1 WHERE id=?")
      .run(reservation.job.id);
    database.prepare("UPDATE idempotency SET expires_at=1 WHERE job_id=?").run(reservation.job.id);
    const auth = {
      api: {
        getSession: async () => null,
        signUpEmail: async () => {
          throw new Error("unused");
        },
      },
      handler: async () => new Response("{}", { status: 404 }),
    };
    const app = await buildServer(testConfig, {
      auth,
      jobs: {
        files,
        repository,
        scanner: { scan: async () => "clean" as const },
      },
    });
    apps.push(app);

    expect(database.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 0 });
    expect(await files.exists(reservation.job.id)).toBe(false);
  });

  it("closes the default Better Auth database when the job root is unsafe", async () => {
    const testConfig = config();
    const target = join(dirnameForTest(testConfig.jobRoot), "job-target");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, testConfig.jobRoot);
    await expect(buildServer(testConfig)).rejects.toThrow("JOB_ROOT_UNSAFE");
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const database = openDatabase(testConfig.databasePath);
    database.close();
  });
});

function dirnameForTest(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}
