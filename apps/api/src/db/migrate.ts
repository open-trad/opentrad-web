import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDatabase } from "./openDatabase.js";

const MANIFEST = Object.freeze([
  Object.freeze({ id: "001_auth", file: new URL("./migrations/001_auth.sql", import.meta.url) }),
  Object.freeze({ id: "002_jobs", file: new URL("./migrations/002_jobs.sql", import.meta.url) }),
  Object.freeze({
    id: "003_job_admission",
    file: new URL("./migrations/003_job_admission.sql", import.meta.url),
  }),
  Object.freeze({
    id: "004_job_cleanup",
    file: new URL("./migrations/004_job_cleanup.sql", import.meta.url),
  }),
] as const);

export const MIGRATION_IDS = Object.freeze([
  "001_auth",
  "002_jobs",
  "003_job_admission",
  "004_job_cleanup",
] as const);
export type MigrationId = (typeof MIGRATION_IDS)[number];
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicDateNow = Date.now;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicStringIncludes = String.prototype.includes;

interface MigrationRecord {
  readonly id: string;
  readonly checksum: string;
}

export interface MigrationCliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

function migrationError(code: string): Error {
  return new Error(code);
}

function manifestEntry(id: string) {
  for (let index = 0; index < MANIFEST.length; index += 1) {
    const entry = MANIFEST[index];
    if (entry?.id === id) return entry;
  }
  throw migrationError("MIGRATION_ID_INVALID");
}

export function migrationSql(id: MigrationId): string {
  const entry = manifestEntry(id);
  const path = fileURLToPath(entry.file);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw migrationError("MIGRATION_MANIFEST_INVALID");
  const sql = readFileSync(entry.file, "utf8");
  if (
    sql.length === 0 ||
    (intrinsicReflectApply(intrinsicStringIncludes, sql, ["\0"]) as boolean)
  ) {
    throw migrationError("MIGRATION_MANIFEST_INVALID");
  }
  return sql;
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function loadManifest() {
  const loaded: Array<{
    readonly id: MigrationId;
    readonly sql: string;
    readonly checksum: string;
  }> = [];
  for (let index = 0; index < MANIFEST.length; index += 1) {
    const entry = MANIFEST[index];
    if (entry === undefined) throw migrationError("MIGRATION_MANIFEST_INVALID");
    const sql = migrationSql(entry.id);
    intrinsicReflectApply(intrinsicArrayPush, loaded, [
      Object.freeze({ id: entry.id, sql, checksum: checksum(sql) }),
    ]);
  }
  return Object.freeze(loaded);
}

function createMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at INTEGER NOT NULL CHECK (applied_at >= 0)
    ) STRICT
  `);
}

function assertAppliedPrefix(
  existing: readonly MigrationRecord[],
  manifest: ReturnType<typeof loadManifest>,
): void {
  if (existing.length > manifest.length) throw migrationError("MIGRATION_STATE_INVALID");
  for (let index = 0; index < existing.length; index += 1) {
    const applied = existing[index];
    const expected = manifest[index];
    if (applied === undefined || expected === undefined || applied.id !== expected.id) {
      throw migrationError("MIGRATION_STATE_INVALID");
    }
    if (applied.checksum !== expected.checksum) {
      throw migrationError("MIGRATION_CHECKSUM_MISMATCH");
    }
  }
}

export function applyMigrations(databasePath: string): readonly MigrationId[] {
  const manifest = loadManifest();
  const database = openDatabase(databasePath);
  const applied: MigrationId[] = [];
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      createMigrationTable(database);
      const existing = database
        .prepare("SELECT id, checksum FROM schema_migrations ORDER BY rowid")
        .all() as MigrationRecord[];
      assertAppliedPrefix(existing, manifest);
      const insert = database.prepare(
        "INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)",
      );
      for (let index = existing.length; index < manifest.length; index += 1) {
        const migration = manifest[index];
        if (migration === undefined) throw migrationError("MIGRATION_MANIFEST_INVALID");
        database.exec(migration.sql);
        insert.run(migration.id, migration.checksum, intrinsicDateNow());
        intrinsicReflectApply(intrinsicArrayPush, applied, [migration.id]);
      }
      database.exec("COMMIT");
    } catch (error) {
      if (database.inTransaction) database.exec("ROLLBACK");
      throw error;
    }
    return Object.freeze(applied);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "MIGRATION_CHECKSUM_MISMATCH" ||
        error.message === "MIGRATION_STATE_INVALID" ||
        error.message === "MIGRATION_MANIFEST_INVALID")
    ) {
      throw error;
    }
    throw migrationError("MIGRATION_FAILED");
  } finally {
    database.close();
  }
}

function ownStringAt(args: readonly string[], index: number): string | undefined {
  const descriptor = intrinsicGetOwnPropertyDescriptor(args, String(index));
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function parseCliArgs(
  args: unknown,
): { readonly mode: "apply" | "dry-run"; readonly path?: string } | undefined {
  if (!intrinsicArrayIsArray(args) || intrinsicGetPrototypeOf(args) !== intrinsicArrayPrototype) {
    return undefined;
  }
  const rawLength = intrinsicGetOwnPropertyDescriptor(args, "length")?.value;
  if (rawLength !== 1 && rawLength !== 2 && rawLength !== 3 && rawLength !== 4) return undefined;
  if (intrinsicReflectOwnKeys(args).length !== rawLength + 1) return undefined;
  const hasPackageManagerSeparator = rawLength === 2 || rawLength === 4;
  if (hasPackageManagerSeparator && ownStringAt(args, 0) !== "--") return undefined;
  const offset = hasPackageManagerSeparator ? 1 : 0;
  const length = rawLength - offset;
  if (length !== 1 && length !== 3) return undefined;
  const first = ownStringAt(args, offset);
  if (length === 1 && first === "--apply") return { mode: "apply" };
  if (length === 1 && first === "--dry-run") return { mode: "dry-run" };
  const second = ownStringAt(args, offset + 1);
  const third = ownStringAt(args, offset + 2);
  if (
    length === 3 &&
    first === "--database" &&
    second !== undefined &&
    second.length > 0 &&
    (third === "--apply" || third === "--dry-run")
  ) {
    return { mode: third === "--apply" ? "apply" : "dry-run", path: second };
  }
  return undefined;
}

function ownEnvironmentPath(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const descriptor = intrinsicGetOwnPropertyDescriptor(env, "OPENTRAD_DATABASE_PATH");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function snapshotCliIo(value: unknown): MigrationCliIo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const prototype = intrinsicGetPrototypeOf(value);
  if (prototype !== intrinsicObjectPrototype && prototype !== null) return undefined;
  if (intrinsicReflectOwnKeys(value).length !== 2) return undefined;
  const stdout = intrinsicGetOwnPropertyDescriptor(value, "stdout");
  const stderr = intrinsicGetOwnPropertyDescriptor(value, "stderr");
  if (
    stdout === undefined ||
    !("value" in stdout) ||
    typeof stdout.value !== "function" ||
    stderr === undefined ||
    !("value" in stderr) ||
    typeof stderr.value !== "function"
  ) {
    return undefined;
  }
  return { stderr: stderr.value, stdout: stdout.value };
}

function writeCliLine(callback: (line: string) => void, line: string): boolean {
  try {
    intrinsicReflectApply(callback, undefined, [line]);
    return true;
  } catch {
    return false;
  }
}

function ioFailure(io: MigrationCliIo): 74 {
  writeCliLine(io.stderr, "MIGRATION_IO_ERROR");
  return 74;
}

function writeCliError(io: MigrationCliIo, line: string, code: number): number {
  return writeCliLine(io.stderr, line) ? code : 74;
}

export function runMigrationCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: MigrationCliIo,
): number {
  let safeIo: MigrationCliIo | undefined;
  try {
    safeIo = snapshotCliIo(io);
  } catch {
    safeIo = undefined;
  }
  if (safeIo === undefined) return 74;

  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(args);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    return writeCliError(safeIo, "MIGRATION_ARGUMENT_ERROR", 64);
  }
  if (parsed.mode === "dry-run") {
    for (let index = 0; index < MIGRATION_IDS.length; index += 1) {
      const id = MIGRATION_IDS[index];
      if (id === undefined) return 70;
      if (!writeCliLine(safeIo.stdout, id)) return ioFailure(safeIo);
    }
    return 0;
  }

  let path: string | undefined;
  try {
    path = parsed.path ?? ownEnvironmentPath(env);
  } catch {
    path = undefined;
  }
  if (path === undefined || path.length === 0) {
    return writeCliError(safeIo, "MIGRATION_CONFIGURATION_ERROR", 78);
  }
  let applied: readonly MigrationId[];
  try {
    applied = applyMigrations(path);
  } catch {
    return writeCliError(safeIo, "MIGRATION_FAILED", 1);
  }
  for (let index = 0; index < applied.length; index += 1) {
    const id = applied[index];
    if (id === undefined) return 70;
    if (!writeCliLine(safeIo.stdout, id)) return ioFailure(safeIo);
  }
  return 0;
}

function isDirectInvocation(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  return fileURLToPath(import.meta.url) === entrypoint;
}

if (isDirectInvocation()) {
  const exitCode = runMigrationCli(process.argv.slice(2), process.env, {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = exitCode;
}
