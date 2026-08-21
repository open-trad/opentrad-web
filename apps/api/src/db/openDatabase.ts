import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import Database from "better-sqlite3";

const DATABASE_PARENT_MODE = 0o700;
const DATABASE_FILE_MODE = 0o600;
const MAX_PATH_LENGTH = 4_096;
const managedWriters = new Set<string>();
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicReflectApply = Reflect.apply;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetDelete = Set.prototype.delete;
const intrinsicSetHas = Set.prototype.has;
const intrinsicStatsIsDirectory = Stats.prototype.isDirectory;
const intrinsicStatsIsFile = Stats.prototype.isFile;
const intrinsicStatsIsSymbolicLink = Stats.prototype.isSymbolicLink;
const intrinsicStringIncludes = String.prototype.includes;

function stringIncludes(value: string, search: string): boolean {
  return intrinsicReflectApply(intrinsicStringIncludes, value, [search]) as boolean;
}

function setHas(value: string): boolean {
  return intrinsicReflectApply(intrinsicSetHas, managedWriters, [value]) as boolean;
}

function setAdd(value: string): void {
  intrinsicReflectApply(intrinsicSetAdd, managedWriters, [value]);
}

function setDelete(value: string): void {
  intrinsicReflectApply(intrinsicSetDelete, managedWriters, [value]);
}

function statIsDirectory(stat: Stats): boolean {
  return intrinsicReflectApply(intrinsicStatsIsDirectory, stat, []) as boolean;
}

function statIsFile(stat: Stats): boolean {
  return intrinsicReflectApply(intrinsicStatsIsFile, stat, []) as boolean;
}

function statIsSymbolicLink(stat: Stats): boolean {
  return intrinsicReflectApply(intrinsicStatsIsSymbolicLink, stat, []) as boolean;
}

function databaseError(code: string): Error {
  return new Error(code);
}

function assertPrimitivePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    stringIncludes(value, "\0") ||
    stringIncludes(value, "\n") ||
    stringIncludes(value, "\r")
  ) {
    throw databaseError("DATABASE_PATH_INVALID");
  }
}

function prepareRealDatabasePath(input: unknown): { path: string; created: boolean } {
  assertPrimitivePath(input);
  if (!isAbsolute(input) || normalize(input) !== input) {
    throw databaseError("DATABASE_PATH_INVALID");
  }

  const parent = dirname(input);
  if (parent === input) throw databaseError("DATABASE_PATH_INVALID");

  let physicalParent: string;
  if (!existsSync(parent)) {
    const grandparent = dirname(parent);
    if (grandparent === parent || !existsSync(grandparent)) {
      throw databaseError("DATABASE_PARENT_UNSAFE");
    }
    const physicalGrandparent = realpathSync(grandparent);
    const grandparentEntry = lstatSync(physicalGrandparent);
    if (!statIsDirectory(grandparentEntry) || statIsSymbolicLink(grandparentEntry)) {
      throw databaseError("DATABASE_PARENT_UNSAFE");
    }
    physicalParent = join(physicalGrandparent, basename(parent));
    mkdirSync(physicalParent, { mode: DATABASE_PARENT_MODE, recursive: false });
  } else {
    const parentEntry = lstatSync(parent);
    if (statIsSymbolicLink(parentEntry) || !statIsDirectory(parentEntry)) {
      throw databaseError("DATABASE_PARENT_UNSAFE");
    }
    physicalParent = realpathSync(parent);
  }

  const parentEntry = lstatSync(physicalParent);
  if (
    statIsSymbolicLink(parentEntry) ||
    !statIsDirectory(parentEntry) ||
    (parentEntry.mode & 0o777) !== DATABASE_PARENT_MODE
  ) {
    throw databaseError("DATABASE_PARENT_UNSAFE");
  }

  const physicalPath = join(physicalParent, basename(input));

  if (existsSync(physicalPath)) {
    const entry = lstatSync(physicalPath);
    if (!statIsFile(entry) || statIsSymbolicLink(entry) || entry.nlink !== 1) {
      throw databaseError("DATABASE_PATH_UNSAFE");
    }
    const canonicalPath = realpathSync(physicalPath);
    const canonicalEntry = lstatSync(canonicalPath);
    if (
      !statIsFile(canonicalEntry) ||
      statIsSymbolicLink(canonicalEntry) ||
      canonicalEntry.nlink !== 1
    ) {
      throw databaseError("DATABASE_PATH_UNSAFE");
    }
    chmodSync(canonicalPath, DATABASE_FILE_MODE);
    return { path: canonicalPath, created: false };
  }

  const descriptor = openSync(
    physicalPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
    DATABASE_FILE_MODE,
  );
  closeSync(descriptor);
  const createdEntry = lstatSync(physicalPath);
  if (!statIsFile(createdEntry) || statIsSymbolicLink(createdEntry) || createdEntry.nlink !== 1) {
    rmSync(physicalPath, { force: true });
    throw databaseError("DATABASE_PATH_UNSAFE");
  }
  chmodSync(physicalPath, DATABASE_FILE_MODE);
  return { path: physicalPath, created: true };
}

function configureDatabase(database: Database.Database, requireWal: boolean): void {
  database.pragma("foreign_keys = ON");
  const journalMode = database.pragma("journal_mode = WAL", { simple: true });
  if (requireWal && journalMode !== "wal") throw databaseError("DATABASE_WAL_REQUIRED");
  database.pragma("synchronous = FULL");
  database.pragma("busy_timeout = 5000");
  if (
    database.pragma("foreign_keys", { simple: true }) !== 1 ||
    database.pragma("synchronous", { simple: true }) !== 2 ||
    database.pragma("busy_timeout", { simple: true }) !== 5_000
  ) {
    throw databaseError("DATABASE_PRAGMA_FAILED");
  }
}

function registerManagedClose(database: Database.Database, path: string): void {
  const nativeClose = database.close;
  intrinsicDefineProperty(database, "close", {
    configurable: false,
    enumerable: false,
    value: () => {
      intrinsicReflectApply(nativeClose, database, []);
      setDelete(path);
    },
    writable: false,
  });
}

export function openDatabase(path: string): Database.Database {
  if (path === ":memory:") {
    const database = new Database(path, { timeout: 5_000 });
    try {
      configureDatabase(database, false);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  const prepared = prepareRealDatabasePath(path);
  if (setHas(prepared.path)) {
    if (prepared.created) rmSync(prepared.path, { force: true });
    throw databaseError("DATABASE_ALREADY_OPEN");
  }
  setAdd(prepared.path);

  let database: Database.Database | undefined;
  try {
    database = new Database(prepared.path, { timeout: 5_000 });
    configureDatabase(database, true);
    chmodSync(prepared.path, DATABASE_FILE_MODE);
    registerManagedClose(database, prepared.path);
    return database;
  } catch (error) {
    if (database?.open) database.close();
    setDelete(prepared.path);
    if (prepared.created) rmSync(prepared.path, { force: true });
    if (
      error instanceof Error &&
      (error.message === "DATABASE_WAL_REQUIRED" || error.message === "DATABASE_PRAGMA_FAILED")
    ) {
      throw error;
    }
    throw databaseError("DATABASE_OPEN_FAILED");
  }
}
