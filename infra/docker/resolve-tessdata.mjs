#!/usr/bin/env node
import { createHash } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commit = "87416418657359cb625c412a48b6e1d6d41c29bd";
const ids = ["chi_sim", "eng", "osd"];
const files = [];
for (const id of ids) {
  const source = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}/${id}.traineddata`;
  try {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(120_000),
      headers: { "user-agent": "OpenTrad-lock-resolver/1" },
    });
    if (!response.ok) throw new Error();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100_000 || bytes.length > 20 * 1024 * 1024) throw new Error();
    files.push({ id, source, sha256: createHash("sha256").update(bytes).digest("hex") });
  } catch {
    process.stderr.write(`PAUSE_SUPPLY_CHAIN:CHECKSUM_UNAVAILABLE:tessdata-${id}\n`);
    process.exit(78);
  }
}

const directory = dirname(fileURLToPath(import.meta.url));
const temporary = resolve(directory, `.tessdata.lock.json.${process.pid}`);
try {
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, commit, files }, null, 2)}\n`, {
    mode: 0o644,
    flag: "wx",
  });
  renameSync(temporary, resolve(directory, "tessdata.lock.json"));
} finally {
  rmSync(temporary, { force: true });
}
