import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "../../apps/api/dist/auth/auth.js";
import { loadConfig } from "../../apps/api/dist/config.js";
import { applyMigrations } from "../../apps/api/dist/db/migrate.js";
import { JobFiles } from "../../apps/api/dist/jobs/jobFiles.js";
import { runJobReconciliation } from "../../apps/api/dist/jobs/jobReconcile.js";
import { JobRepository } from "../../apps/api/dist/jobs/jobRepository.js";
import { buildServer } from "../../apps/api/dist/server.js";
import { createWorkerClaimRuntimeForTesting, runClaim } from "../../apps/worker/dist/main.js";
import { WorkerQueue } from "../../apps/worker/dist/queue.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const runId = process.env.OPENTRAD_E2E_RUN_ID;
if (!runId || !/^[0-9a-f-]{36}$/u.test(runId)) throw new Error("E2E_RUN_ID_INVALID");
const pointerPath = join(tmpdir(), `opentrad-e2e-stack-state-${runId}.json`);
const runtimeRoot = mkdtempSync(join(tmpdir(), "opentrad-e2e-stack-"));
const databasePath = join(runtimeRoot, "opentrad.sqlite");
const jobRoot = join(runtimeRoot, "jobs");
const logPath = join(runtimeRoot, "api.log");
const keyPath = join(runtimeRoot, "tls.key");
const certificatePath = join(runtimeRoot, "tls.crt");
const staticRoot = resolve(repositoryRoot, "apps/web/dist");
const publicOrigin = "https://opentrad.dynv6.net:4173";
const publicHost = "opentrad.dynv6.net:4173";

execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    "/CN=opentrad.dynv6.net",
    "-addext",
    "subjectAltName=DNS:opentrad.dynv6.net,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
chmodSync(keyPath, 0o600);
chmodSync(certificatePath, 0o600);

applyMigrations(databasePath);
const logStream = Object.freeze({
  write: (chunk) => {
    appendFileSync(logPath, typeof chunk === "string" ? chunk : Buffer.from(chunk));
  },
});
const config = loadConfig({
  BETTER_AUTH_SECRET: "e2e-better-auth-secret-".repeat(4),
  NODE_ENV: "production",
  OPENTRAD_CLAMD_HOST: "127.0.0.1",
  OPENTRAD_CLAMD_PORT: "3310",
  OPENTRAD_DATABASE_PATH: databasePath,
  OPENTRAD_JOB_ROOT: jobRoot,
  OPENTRAD_PUBLIC_ORIGIN: publicOrigin,
  OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1",
});
const auth = createAuth(config);
const database = auth.options.database;
if (!database || !("prepare" in database)) throw new Error("E2E_DATABASE_UNAVAILABLE");
const workerGid = process.getgid?.() ?? 0;
const files = new JobFiles(jobRoot, { workerGid });
const repository = new JobRepository(database, {
  idempotencySecret: "e2e-idempotency-secret-".repeat(4),
});
const jobs = Object.freeze({
  files,
  repository,
  scanner: Object.freeze({
    scan: async (source) => {
      for await (const _chunk of source) {
        // Consume the exact upload without retaining it outside the job root.
      }
      return "clean";
    },
  }),
});
const app = await buildServer(config, { auth, jobs, logStream });
await app.listen({ host: "127.0.0.1", port: 3_000 });
const queue = new WorkerQueue(realpathSync(jobRoot), { workerGid });
let workerRunning = false;

async function runWorkerOnce() {
  if (workerRunning) return { outcome: "busy" };
  workerRunning = true;
  try {
    const claim = await queue.claimNext();
    if (!claim) return { outcome: "empty" };
    const outcome = await runClaim(claim, queue, createWorkerClaimRuntimeForTesting(queue));
    await runJobReconciliation({ files, repository });
    return { outcome };
  } finally {
    workerRunning = false;
  }
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(request, response, pathname) {
  let candidate = resolve(staticRoot, `.${pathname}`);
  const withinRoot = candidate === staticRoot || candidate.startsWith(`${staticRoot}${sep}`);
  if (!withinRoot) {
    response.writeHead(404).end();
    return;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile())
    candidate = join(staticRoot, "index.html");
  const info = statSync(candidate);
  response.writeHead(200, {
    "cache-control": candidate.endsWith("index.html")
      ? "no-store"
      : "public, max-age=31536000, immutable",
    "content-length": String(info.size),
    "content-type": contentType(candidate),
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(candidate).pipe(response);
}

function proxyApi(request, response) {
  const upstreamHeaders = { ...request.headers };
  for (const name of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) {
    delete upstreamHeaders[name];
  }
  Object.assign(upstreamHeaders, {
    host: publicHost,
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-host": publicHost,
    "x-forwarded-proto": "https",
  });
  const upstream = httpRequest(
    {
      headers: upstreamHeaders,
      host: "127.0.0.1",
      method: request.method,
      path: request.url,
      port: 3_000,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => response.writeHead(502).end());
  request.pipe(upstream);
}

const tlsServer = createHttpsServer(
  { cert: readFileSync(certificatePath), key: readFileSync(keyPath) },
  (request, response) => {
    const url = new URL(request.url ?? "/", publicOrigin);
    if (url.pathname === "/__e2e__/worker/run-once" && request.method === "POST") {
      void runWorkerOnce().then(
        (result) => {
          const body = Buffer.from(JSON.stringify(result));
          response.writeHead(200, {
            "content-length": String(body.byteLength),
            "content-type": "application/json",
          });
          response.end(body);
        },
        () => response.writeHead(500).end(),
      );
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      proxyApi(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    serveStatic(request, response, url.pathname);
  },
);
await new Promise((resolvePromise, rejectPromise) => {
  tlsServer.once("error", rejectPromise);
  tlsServer.listen(4_173, "127.0.0.1", resolvePromise);
});

writeFileSync(
  pointerPath,
  `${JSON.stringify({ databasePath, jobRoot, logPath, pid: process.pid, runId, runtimeRoot })}\n`,
  { mode: 0o600 },
);
process.stdout.write("E2E_STACK_READY\n");

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolvePromise) => tlsServer.close(resolvePromise));
  await app.close().catch(() => undefined);
  database.close();
  rmSync(pointerPath, { force: true });
  rmSync(runtimeRoot, { force: true, recursive: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void close().finally(() => process.exit(0));
  });
}
