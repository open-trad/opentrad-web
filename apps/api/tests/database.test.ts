import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

function privateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opentrad-database-"));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

function tableColumns(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info("${table}")`).all() as ReadonlyArray<{
      name: string;
    }>
  ).map((column) => column.name);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("secure SQLite opener", () => {
  it("opens a real database with private permissions and production pragmas", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const databasePath = join(root, "opentrad.sqlite");

    const database = openDatabase(databasePath);
    try {
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("synchronous", { simple: true })).toBe(2);
      expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);
      expect(mode(root)).toBe(0o700);
      expect(mode(databasePath)).toBe(0o600);
    } finally {
      database.close();
    }
  });

  it("creates only a private direct parent for a new database", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const parent = join(privateRoot(), "database");
    const database = openDatabase(join(parent, "opentrad.sqlite"));
    database.close();
    expect(mode(parent)).toBe(0o700);
  });

  it("fails closed instead of recursively creating multiple missing directories", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const firstMissing = join(root, "missing");
    expect(() => openDatabase(join(firstMissing, "nested", "opentrad.sqlite"))).toThrow(
      "DATABASE_PARENT_UNSAFE",
    );
    expect(existsSync(firstMissing)).toBe(false);
  });

  it("supports isolated in-memory databases without filesystem mutation", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const database = openDatabase(":memory:");
    try {
      expect(database.memory).toBe(true);
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("synchronous", { simple: true })).toBe(2);
      expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);
    } finally {
      database.close();
    }
  });

  it("rejects hostile, relative, non-canonical, and unsafe-parent paths without disclosure", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const unsafeParent = join(root, "unsafe");
    mkdirSync(unsafeParent, { mode: 0o755 });
    const candidates: unknown[] = [
      "relative.sqlite",
      `${root}/nested/../opentrad.sqlite`,
      `${join(root, "newline.sqlite")}\nprivate`,
      "file:/tmp/opentrad.sqlite",
      "",
      new String(join(root, "boxed.sqlite")),
      join(unsafeParent, "opentrad.sqlite"),
      join(root, "x".repeat(300), "opentrad.sqlite"),
    ];

    for (const candidate of candidates) {
      let failure: unknown;
      try {
        openDatabase(candidate as string);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      if (String(candidate).length > 0) expect(String(failure)).not.toContain(String(candidate));
    }
  });

  it("rejects database and parent-directory symlinks", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const realParent = join(root, "real");
    mkdirSync(realParent, { mode: 0o700 });
    const linkedParent = join(root, "linked");
    symlinkSync(realParent, linkedParent);
    expect(() => openDatabase(join(linkedParent, "opentrad.sqlite"))).toThrow();

    const target = join(realParent, "target.sqlite");
    const seed = new Database(target);
    seed.close();
    chmodSync(target, 0o600);
    const linkedFile = join(realParent, "linked.sqlite");
    symlinkSync(target, linkedFile);
    expect(() => openDatabase(linkedFile)).toThrow();
  });

  it("allows one managed writer per real path and releases it on close", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const databasePath = join(privateRoot(), "opentrad.sqlite");
    const first = openDatabase(databasePath);
    expect(() => openDatabase(databasePath)).toThrow("DATABASE_ALREADY_OPEN");
    first.close();
    const reopened = openDatabase(databasePath);
    reopened.close();
  });

  it("canonicalizes ancestor aliases before enforcing the single writer", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const physicalParent = join(root, "physical");
    const nested = join(physicalParent, "nested");
    mkdirSync(physicalParent, { mode: 0o700 });
    mkdirSync(nested, { mode: 0o700 });
    symlinkSync(physicalParent, join(root, "alias"));

    const physicalPath = join(nested, "opentrad.sqlite");
    const aliasedPath = join(root, "alias", "nested", "opentrad.sqlite");
    const first = openDatabase(physicalPath);
    try {
      expect(() => openDatabase(aliasedPath)).toThrow("DATABASE_ALREADY_OPEN");
    } finally {
      first.close();
    }
  });

  it("rejects hard-linked database aliases", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const root = privateRoot();
    const physicalParent = join(root, "physical");
    const aliasParent = join(root, "alias");
    mkdirSync(physicalParent, { mode: 0o700 });
    mkdirSync(aliasParent, { mode: 0o700 });
    const physicalPath = join(physicalParent, "opentrad.sqlite");
    const aliasPath = join(aliasParent, "opentrad.sqlite");
    const first = openDatabase(physicalPath);
    let duplicate: Database.Database | undefined;
    let failure: unknown;
    try {
      linkSync(physicalPath, aliasPath);
      try {
        duplicate = openDatabase(aliasPath);
      } catch (error) {
        failure = error;
      }
      expect(String(failure)).toBe("Error: DATABASE_PATH_UNSAFE");
    } finally {
      duplicate?.close();
      first.close();
    }
  });

  it("keeps path validation and writer-lock cleanup stable under prototype poisoning", async () => {
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    const statPrototype = Object.getPrototypeOf(lstatSync(privateRoot()));
    const descriptors = [
      [String.prototype, "includes", Object.getOwnPropertyDescriptor(String.prototype, "includes")],
      [Set.prototype, "has", Object.getOwnPropertyDescriptor(Set.prototype, "has")],
      [Set.prototype, "add", Object.getOwnPropertyDescriptor(Set.prototype, "add")],
      [Set.prototype, "delete", Object.getOwnPropertyDescriptor(Set.prototype, "delete")],
      [Object, "defineProperty", Object.getOwnPropertyDescriptor(Object, "defineProperty")],
      [statPrototype, "isDirectory", Object.getOwnPropertyDescriptor(statPrototype, "isDirectory")],
      [statPrototype, "isFile", Object.getOwnPropertyDescriptor(statPrototype, "isFile")],
      [
        statPrototype,
        "isSymbolicLink",
        Object.getOwnPropertyDescriptor(statPrototype, "isSymbolicLink"),
      ],
      [
        Database.prototype.close,
        "bind",
        Object.getOwnPropertyDescriptor(Database.prototype.close, "bind"),
      ],
    ] as const;
    const poison = () => {
      throw new Error("poisoned prototype");
    };
    let database: Database.Database | undefined;
    try {
      for (const [target, property] of descriptors) {
        Reflect.defineProperty(target, property, {
          configurable: true,
          value: poison,
          writable: true,
        });
      }
      database = openDatabase(path);
      database.exec("CREATE TABLE proof (id INTEGER) STRICT");
      database.close();
      database = undefined;
    } finally {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor === undefined) Reflect.deleteProperty(target, property);
        else Reflect.defineProperty(target, property, descriptor);
      }
      if (database?.open) database.close();
    }

    const reopened = openDatabase(path);
    reopened.close();
  });
});

describe("reviewed migration manifest", () => {
  it("matches Better Auth 1.7.1 core plus the username field", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql("001_auth"));
      expect(tableColumns(database, "user")).toEqual([
        "id",
        "name",
        "email",
        "emailVerified",
        "image",
        "createdAt",
        "updatedAt",
        "username",
      ]);
      expect(tableColumns(database, "session")).toEqual([
        "id",
        "expiresAt",
        "token",
        "createdAt",
        "updatedAt",
        "ipAddress",
        "userAgent",
        "userId",
      ]);
      expect(tableColumns(database, "account")).toEqual([
        "id",
        "issuer",
        "accountId",
        "providerId",
        "userId",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "scope",
        "password",
        "createdAt",
        "updatedAt",
      ]);
      expect(tableColumns(database, "verification")).toEqual([
        "id",
        "identifier",
        "value",
        "expiresAt",
        "createdAt",
        "updatedAt",
      ]);

      const accountIndexes = database.prepare('PRAGMA index_list("account")').all() as Array<{
        name: string;
        unique: number;
      }>;
      const composite = accountIndexes.find((index) => {
        if (index.unique !== 1) return false;
        const columns = database.prepare(`PRAGMA index_info("${index.name}")`).all() as Array<{
          name: string;
        }>;
        return columns.map((column) => column.name).join(",") === "issuer,accountId";
      });
      expect(composite).toBeDefined();
      expect(composite?.name).toBe("account_issuer_accountId_uidx");
    } finally {
      database.close();
    }
  });

  it("is a no-op under Better Auth 1.7.1 official migration introspection", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql("001_auth"));
      const migrations = await getMigrations({
        database,
        plugins: [username({ displayUsername: false, immutableUsername: true })],
      });
      expect(migrations.toBeCreated).toEqual([]);
      expect(migrations.toBeAdded).toEqual([]);
      expect(migrations.toBeAddedIndexes).toEqual([]);
      expect((await migrations.compileMigrations()).replaceAll(";", "").trim()).toBe("");
    } finally {
      database.close();
    }
  });

  it("supports a real Better Auth username signup against the reviewed schema", async () => {
    const { applyMigrations } = await import("../src/db/migrate.js");
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    applyMigrations(path);
    const database = openDatabase(path);
    try {
      const auth = betterAuth({
        baseURL: "https://opentrad.example",
        database,
        emailAndPassword: { enabled: true, minPasswordLength: 12 },
        logger: { disabled: true },
        plugins: [username({ displayUsername: false, immutableUsername: true })],
        secret: "a".repeat(48),
      });
      const created = await auth.api.signUpEmail({
        body: {
          email: "opaque@users.opentrad.invalid",
          name: "trade_user",
          password: "correct-horse-battery-staple",
          username: "trade_user",
        },
      });
      expect(created.user.username).toBe("trade_user");
      expect(
        database.prepare('SELECT username FROM "user" WHERE id = ?').get(created.user.id),
      ).toEqual({ username: "trade_user" });
    } finally {
      database.close();
    }
  });

  it("aligns job metadata with the public status contract and excludes document secrets", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const sql = migrationSql("002_jobs");
    expect(sql).not.toMatch(
      /source[_ ]?file|file[_ ]?name|document[_ ]?(?:text|body)|input[_ ]?hash/i,
    );
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql("001_auth"));
      database.exec(sql);
      expect(tableColumns(database, "jobs")).toEqual([
        "id",
        "owner_id",
        "operation",
        "input_format",
        "output_format",
        "quality",
        "status",
        "input_bytes",
        "page_count",
        "created_at",
        "started_at",
        "expires_at",
        "queue_position",
        "progress_phase",
        "progress_completed",
        "progress_total",
        "cancel_requested",
        "error_code",
        "error_retryable",
        "result_media_type",
        "result_bytes",
      ]);
      expect(tableColumns(database, "daily_usage")).toEqual([
        "owner_id",
        "utc_day",
        "accepted_count",
      ]);
      expect(tableColumns(database, "idempotency")).toEqual([
        "owner_id",
        "key_hmac",
        "operation",
        "input_format",
        "output_format",
        "input_bytes",
        "job_id",
        "expires_at",
      ]);
    } finally {
      database.close();
    }
  });

  it("adds only the canonical request shape and atomic result claim state", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const sql = migrationSql("003_job_admission");
    expect(sql).not.toMatch(/canonical_options|file[_ ]?name|content[_ ]?(?:hash|digest)/iu);
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql("001_auth"));
      database.exec(migrationSql("002_jobs"));
      database.exec(sql);
      expect(tableColumns(database, "idempotency").slice(-1)).toEqual(["request_shape"]);
      expect(tableColumns(database, "jobs").slice(-3)).toEqual([
        "result_claim_token",
        "result_claimed_at",
        "result_consumed",
      ]);
    } finally {
      database.close();
    }
  });

  it("adds only durable cleanup claim state in the follow-up immutable migration", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const sql = migrationSql("004_job_cleanup");
    expect(sql).not.toMatch(
      /file[_ ]?name|document[_ ]?(?:text|body)|content[_ ]?(?:hash|digest)/iu,
    );
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql("001_auth"));
      database.exec(migrationSql("002_jobs"));
      database.exec(migrationSql("003_job_admission"));
      database.exec(sql);
      expect(tableColumns(database, "jobs").slice(-3)).toEqual([
        "cleanup_kind",
        "cleanup_token",
        "cleanup_claimed_at",
      ]);
    } finally {
      database.close();
    }
  });

  it("enforces current status, quality, progress, result, and error invariants", async () => {
    const { applyMigrations } = await import("../src/db/migrate.js");
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    applyMigrations(path);
    const database = openDatabase(path);
    const base = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      "office.to.pdf",
      "docx",
      "pdf",
      "B",
      "queued",
      10,
      Date.now(),
      Date.now() + 60_000,
    ] as const;
    try {
      database
        .prepare(
          "INSERT INTO jobs (id, owner_id, operation, input_format, output_format, quality, status, input_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(...base);
      expect(() =>
        database
          .prepare(
            "INSERT INTO jobs (id, owner_id, operation, input_format, output_format, quality, status, input_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(...[crypto.randomUUID(), ...base.slice(1, 5), "A", ...base.slice(6)]),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            "UPDATE jobs SET status='succeeded', result_media_type=NULL, result_bytes=NULL WHERE id=?",
          )
          .run(base[0]),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            "UPDATE jobs SET status='running', progress_phase='converting', progress_completed=2, progress_total=1 WHERE id=?",
          )
          .run(base[0]),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("stores the planned SHA-256 base64url idempotency HMAC shape", async () => {
    const { migrationSql } = await import("../src/db/migrate.js");
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    try {
      database.exec(migrationSql("001_auth"));
      database.exec(migrationSql("002_jobs"));
      const jobId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      database
        .prepare(
          "INSERT INTO jobs (id, owner_id, operation, input_format, output_format, quality, status, input_bytes, created_at, expires_at) VALUES (?, ?, 'office.to.pdf', 'docx', 'pdf', 'B', 'queued', 10, 1, 2)",
        )
        .run(jobId, ownerId);
      expect(() =>
        database
          .prepare(
            "INSERT INTO idempotency (owner_id, key_hmac, operation, input_format, output_format, input_bytes, job_id, expires_at) VALUES (?, ?, 'office.to.pdf', 'docx', 'pdf', 10, ?, 2)",
          )
          .run(ownerId, "A".repeat(43), jobId),
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("applies the explicit manifest once and records SHA-256 checksums", async () => {
    const { MIGRATION_IDS, applyMigrations } = await import("../src/db/migrate.js");
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    expect(applyMigrations(path)).toEqual(MIGRATION_IDS);
    expect(applyMigrations(path)).toEqual([]);
    const database = openDatabase(path);
    try {
      const rows = database
        .prepare("SELECT id, checksum FROM schema_migrations ORDER BY id")
        .all() as Array<{ id: string; checksum: string }>;
      expect(rows.map((row) => row.id)).toEqual(MIGRATION_IDS);
      expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    } finally {
      database.close();
    }
  });

  it("rejects checksum drift without revealing paths, SQL, or hashes", async () => {
    const { applyMigrations } = await import("../src/db/migrate.js");
    const { openDatabase } = await import("../src/db/openDatabase.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    applyMigrations(path);
    const database = openDatabase(path);
    database
      .prepare("UPDATE schema_migrations SET checksum=? WHERE id='001_auth'")
      .run("0".repeat(64));
    database.close();
    let failure: unknown;
    try {
      applyMigrations(path);
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toBe("Error: MIGRATION_CHECKSUM_MISMATCH");
    expect(String(failure)).not.toContain(path);
    expect(String(failure)).not.toContain("00000000");
    expect(String(failure)).not.toContain("CREATE TABLE");
  });

  it("rolls back every migration when a later manifest step fails", async () => {
    const { applyMigrations } = await import("../src/db/migrate.js");
    const path = join(privateRoot(), "opentrad.sqlite");
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      CREATE TRIGGER stop_second_migration
      BEFORE INSERT ON schema_migrations
      WHEN NEW.id = '002_jobs'
      BEGIN SELECT RAISE(ABORT, 'stop'); END;
    `);
    seed.close();
    chmodSync(path, 0o600);

    expect(() => applyMigrations(path)).toThrow("MIGRATION_FAILED");
    const inspected = new Database(path, { readonly: true });
    try {
      const tables = inspected
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(["schema_migrations"]);
      expect(inspected.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
        count: 0,
      });
    } finally {
      inspected.close();
    }
  });

  it("dry-run returns only ordered IDs and never opens its configured database", async () => {
    const { MIGRATION_IDS, runMigrationCli } = await import("../src/db/migrate.js");
    const path = join(privateRoot(), "must-not-exist.sqlite");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = runMigrationCli(
      ["--dry-run"],
      { OPENTRAD_DATABASE_PATH: path },
      { stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line) },
    );
    expect(code).toBe(0);
    expect(stdout).toEqual([...MIGRATION_IDS]);
    expect(stderr).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("accepts the package-manager argument separator for the documented dry-run", async () => {
    const { MIGRATION_IDS, runMigrationCli } = await import("../src/db/migrate.js");
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(
      runMigrationCli(
        ["--", "--dry-run"],
        {},
        {
          stdout: (line: string) => stdout.push(line),
          stderr: (line: string) => stderr.push(line),
        },
      ),
    ).toBe(0);
    expect(stdout).toEqual([...MIGRATION_IDS]);
    expect(stderr).toEqual([]);
  });

  it("accepts only exact CLI modes and keeps all failures non-disclosing", async () => {
    const { runMigrationCli } = await import("../src/db/migrate.js");
    for (const args of [
      [],
      ["--apply", "extra"],
      ["--unknown"],
      ["--dry-run=true"],
      ["--dry-run", "--database", "/private/tmp/ignored.sqlite"],
    ]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(
        runMigrationCli(
          args,
          {},
          {
            stdout: (line: string) => stdout.push(line),
            stderr: (line: string) => stderr.push(line),
          },
        ),
      ).toBe(64);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual(["MIGRATION_ARGUMENT_ERROR"]);
      if (args.length > 0) expect(stderr.join(" ")).not.toContain(args.join(" "));
    }

    const oldPath = join(privateRoot(), "old-name.sqlite");
    const stderr: string[] = [];
    expect(
      runMigrationCli(
        ["--apply"],
        { JOB_DATABASE_PATH: oldPath },
        { stdout: () => undefined, stderr: (line: string) => stderr.push(line) },
      ),
    ).toBe(78);
    expect(stderr).toEqual(["MIGRATION_CONFIGURATION_ERROR"]);
    expect(existsSync(oldPath)).toBe(false);
  });

  it("rejects sparse, inherited, and accessor-backed CLI arguments without evaluating getters", async () => {
    const { runMigrationCli } = await import("../src/db/migrate.js");
    const inherited = new Array<string>(1);
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      value: "--dry-run",
      writable: true,
    });
    const accessor = ["placeholder"];
    let getterCalled = false;
    Object.defineProperty(accessor, "0", {
      configurable: true,
      get: () => {
        getterCalled = true;
        return "--dry-run";
      },
    });
    try {
      for (const args of [inherited, accessor]) {
        const stderr: string[] = [];
        expect(
          runMigrationCli(
            args,
            {},
            { stdout: () => undefined, stderr: (line) => stderr.push(line) },
          ),
        ).toBe(64);
        expect(stderr).toEqual(["MIGRATION_ARGUMENT_ERROR"]);
      }
    } finally {
      if (original === undefined) Reflect.deleteProperty(Array.prototype, "0");
      else Object.defineProperty(Array.prototype, "0", original);
    }
    expect(getterCalled).toBe(false);
  });

  it("rejects hostile CLI IO shapes without invoking accessors or leaking Proxy errors", async () => {
    const { runMigrationCli } = await import("../src/db/migrate.js");
    let getterCalls = 0;
    const accessorIo = { stdout: () => undefined } as Record<string, unknown>;
    Object.defineProperty(accessorIo, "stderr", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("sensitive-io-accessor");
      },
    });
    expect(runMigrationCli([], {}, accessorIo as never)).toBe(74);
    expect(getterCalls).toBe(0);

    let proxyTrapCalls = 0;
    const proxyIo = new Proxy(
      { stderr: () => undefined, stdout: () => undefined },
      {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error("sensitive-io-proxy");
        },
      },
    );
    expect(runMigrationCli([], {}, proxyIo)).toBe(74);
    expect(proxyTrapCalls).toBe(1);

    const inheritedIo = Object.create({ stderr: () => undefined });
    inheritedIo.stdout = () => undefined;
    expect(runMigrationCli([], {}, inheritedIo)).toBe(74);
    expect(
      runMigrationCli([], {}, {
        extra: "not-accepted",
        stderr: () => undefined,
        stdout: () => undefined,
      } as never),
    ).toBe(74);
  });

  it("contains throwing CLI output callbacks behind a fixed IO failure", async () => {
    const { runMigrationCli } = await import("../src/db/migrate.js");
    const stderr: string[] = [];
    expect(
      runMigrationCli(
        ["--dry-run"],
        {},
        {
          stdout: () => {
            throw new Error("sensitive-stdout-marker");
          },
          stderr: (line) => stderr.push(line),
        },
      ),
    ).toBe(74);
    expect(stderr).toEqual(["MIGRATION_IO_ERROR"]);

    expect(
      runMigrationCli(
        [],
        {},
        {
          stdout: () => undefined,
          stderr: () => {
            throw new Error("sensitive-stderr-marker");
          },
        },
      ),
    ).toBe(74);
  });

  it("accepts the database path only as an own environment data property", async () => {
    const { runMigrationCli } = await import("../src/db/migrate.js");
    const path = join(privateRoot(), "must-not-exist.sqlite");
    let getterCalled = false;
    const accessorEnvironment: Record<string, string | undefined> = {};
    Object.defineProperty(accessorEnvironment, "OPENTRAD_DATABASE_PATH", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalled = true;
        return path;
      },
    });
    const inheritedEnvironment = Object.create({ OPENTRAD_DATABASE_PATH: path }) as Record<
      string,
      string | undefined
    >;

    for (const environment of [accessorEnvironment, inheritedEnvironment]) {
      const stderr: string[] = [];
      expect(
        runMigrationCli(["--apply"], environment, {
          stdout: () => undefined,
          stderr: (line) => stderr.push(line),
        }),
      ).toBe(78);
      expect(stderr).toEqual(["MIGRATION_CONFIGURATION_ERROR"]);
    }
    expect(getterCalled).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it("accepts an exact --database path before either mode", async () => {
    const { MIGRATION_IDS, runMigrationCli } = await import("../src/db/migrate.js");
    const dryRunPath = join(privateRoot(), "dry-run.sqlite");
    const dryRunOutput: string[] = [];
    expect(
      runMigrationCli(
        ["--database", dryRunPath, "--dry-run"],
        {},
        { stdout: (line: string) => dryRunOutput.push(line), stderr: () => undefined },
      ),
    ).toBe(0);
    expect(dryRunOutput).toEqual([...MIGRATION_IDS]);
    expect(existsSync(dryRunPath)).toBe(false);

    const applyPath = join(privateRoot(), "apply.sqlite");
    expect(
      runMigrationCli(
        ["--database", applyPath, "--apply"],
        {},
        { stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    expect(existsSync(applyPath)).toBe(true);
  });
});

it("keeps the migration SQL files explicit and immutable at runtime", async () => {
  const { MIGRATION_IDS } = await import("../src/db/migrate.js");
  expect(MIGRATION_IDS).toEqual(["001_auth", "002_jobs", "003_job_admission", "004_job_cleanup"]);
  expect(Object.isFrozen(MIGRATION_IDS)).toBe(true);
  for (const id of MIGRATION_IDS) {
    const contents = readFileSync(
      new URL(`../src/db/migrations/${id}.sql`, import.meta.url),
      "utf8",
    );
    expect(contents.length).toBeGreaterThan(100);
    expect(
      lstatSync(new URL(`../src/db/migrations/${id}.sql`, import.meta.url)).isSymbolicLink(),
    ).toBe(false);
  }
});
