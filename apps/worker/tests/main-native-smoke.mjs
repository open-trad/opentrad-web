import { readFileSync, rmSync } from "node:fs";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../../api/dist/db/migrate.js";
import { openDatabase } from "../../api/dist/db/openDatabase.js";
import { JobFiles } from "../../api/dist/jobs/jobFiles.js";
import { runJobReconciliation } from "../../api/dist/jobs/jobReconcile.js";
import { JobRepository } from "../../api/dist/jobs/jobRepository.js";
import { createWorkerClaimRuntimeForTesting, runClaim } from "../dist/main.js";
import { WorkerQueue } from "../dist/queue.js";

const parent = await mkdtemp(join(tmpdir(), "opentrad-worker-main-native-"));
let database;
try {
  const root = join(parent, "jobs");
  const databasePath = join(parent, "jobs.sqlite");
  applyMigrations(databasePath);
  database = openDatabase(databasePath);
  const files = new JobFiles(root, { workerGid: process.getgid?.() ?? 0 });
  const repository = new JobRepository(database, {
    idempotencySecret: "native-main-idempotency-secret".repeat(3),
  });
  const fixturePath = fileURLToPath(new URL("fixtures/spreadsheet.xlsx.base64", import.meta.url));
  const source = new Uint8Array(Buffer.from(readFileSync(fixturePath, "utf8").trim(), "base64"));
  const original = new Uint8Array(source);
  const request = {
    inputBytes: source.byteLength,
    inputFormat: "xlsx",
    operation: "spreadsheet.to.csv",
    options: { sheetIndex: 1 },
    outputFormat: "csv",
  };
  const ownerId = "00000000-0000-4000-8000-000000000051";
  const reservation = repository.reserveAdmission({
    idempotencyKey: "native-main-idempotency-key-0001",
    ownerId,
    request,
  });
  const jobId = reservation.job.id;
  await files.stageAndQueue({
    declaredBytes: source.byteLength,
    jobId,
    request,
    scan: async (stream) => {
      for await (const _chunk of stream) {
        // Consume the exact real XLSX source.
      }
      return "clean";
    },
    source: (async function* () {
      yield source;
    })(),
  });
  const queue = new WorkerQueue(await realpath(root), { workerGid: process.getgid?.() ?? 0 });
  const claim = await queue.claimNext();
  if (!claim) throw new Error("native main claim missing");
  const outcome = await runClaim(claim, queue, createWorkerClaimRuntimeForTesting(queue));
  await runJobReconciliation({ files, repository });
  const result = await readFile(files.resultPath(jobId));
  const status = repository.findOwnedJob(ownerId, jobId);
  const expected = '中文,"逗号,""引号""","第一行\n第二行",3,1,2\r\n';
  if (
    outcome !== "succeeded" ||
    status?.status !== "succeeded" ||
    status.result?.mediaType !== "text/csv" ||
    status.result.ready !== true ||
    Buffer.compare(Buffer.from(source), Buffer.from(original)) !== 0 ||
    new TextDecoder().decode(result.subarray(3)) !== expected
  ) {
    throw new Error("native worker main smoke failed");
  }
} finally {
  database?.close();
  rmSync(parent, { force: true, recursive: true });
}
