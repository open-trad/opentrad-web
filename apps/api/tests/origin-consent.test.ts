import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiConfig, loadConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { buildServer } from "../src/server.js";

const liveApps: FastifyInstance[] = [];
const temporaryRoots: string[] = [];
const publicOrigin = "https://opentrad.example";
const sameOriginHeaders = {
  host: "opentrad.example",
  origin: publicOrigin,
  "sec-fetch-site": "same-origin",
};
const validRegistration = {
  acknowledgements: { noPasswordRecovery: true },
  password: "correct-horse-battery-staple",
  username: "trade_user",
};

function testConfig(overrides: Readonly<Record<string, string | undefined>> = {}): ApiConfig {
  const root = mkdtempSync(join(tmpdir(), "opentrad-task7-"));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const databasePath = join(root, "opentrad.sqlite");
  applyMigrations(databasePath);
  return loadConfig({
    NODE_ENV: "test",
    OPENTRAD_PUBLIC_ORIGIN: publicOrigin,
    BETTER_AUTH_SECRET: "a".repeat(48),
    OPENTRAD_DATABASE_PATH: databasePath,
    OPENTRAD_JOB_ROOT: join(root, "jobs"),
    OPENTRAD_CLAMD_HOST: "127.0.0.1",
    OPENTRAD_CLAMD_PORT: "3310",
    ...overrides,
  });
}

async function appForTest(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Promise<{ app: FastifyInstance; config: ApiConfig }> {
  const config = testConfig(overrides);
  const app = await buildServer(config);
  liveApps.push(app);
  return { app, config };
}

beforeEach(() => {
  liveApps.length = 0;
  temporaryRoots.length = 0;
});

afterEach(async () => {
  for (const app of liveApps.splice(0)) await app.close();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("same-origin registration boundary", () => {
  it.each([
    ["disabled", {}, false],
    [
      "enabled",
      { GITHUB_CLIENT_ID: "github-id-private", GITHUB_CLIENT_SECRET: "github-secret-private" },
      true,
    ],
  ] as const)(
    "reports GitHub auth availability without secrets when %s",
    async (_name, env, enabled) => {
      const { app } = await appForTest(env);
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth-options",
        headers: { host: "opentrad.example" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ githubEnabled: enabled });
      expect(response.body).not.toContain("github-id-private");
      expect(response.body).not.toContain("github-secret-private");
    },
  );

  it("blocks every public Better Auth signup path without writing auth rows", async () => {
    const { app, config } = await appForTest();
    const publicEmailSignup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: sameOriginHeaders,
      payload: {
        email: "source-email-sentinel@example.com",
        name: "source-email-sentinel",
        password: "correct-horse-battery-staple",
        username: "public_signup",
      },
    });
    const publicUsernameSignup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/username",
      headers: sameOriginHeaders,
      payload: {
        password: "correct-horse-battery-staple",
        username: "equivalent_signup",
      },
    });
    const equivalentSignupResponses = await Promise.all(
      [
        "/api/auth/sign-up/%65%6d%61%69%6c",
        "/api/auth/ignored/../sign-up/email",
        "/api/auth/ignored/%2e%2e/sign-up/%75sername?source=alias",
      ].map((url) =>
        app.inject({
          method: "POST",
          url,
          headers: sameOriginHeaders,
          payload: {
            email: "equivalent-source-sentinel@example.com",
            name: "equivalent-source-sentinel",
            password: "correct-horse-battery-staple",
            username: "equivalent_signup",
          },
        }),
      ),
    );
    const wrongMethod = await app.inject({
      method: "GET",
      url: "/api/auth/sign-up/%65mail",
      headers: { host: "opentrad.example" },
    });

    expect(publicEmailSignup.statusCode).toBe(404);
    expect(publicEmailSignup.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(publicUsernameSignup.statusCode).toBe(404);
    expect(publicUsernameSignup.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    for (const response of equivalentSignupResponses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    }
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(`${publicEmailSignup.body}${publicUsernameSignup.body}`).not.toContain(
      "source-email-sentinel",
    );

    const before = new Database(config.databasePath, { readonly: true });
    try {
      for (const table of ["user", "account", "session"] as const) {
        const row = before.prepare(`SELECT count(*) AS count FROM "${table}"`).get() as {
          count: number;
        };
        expect(row.count, table).toBe(0);
      }
    } finally {
      before.close();
    }

    const privateRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: validRegistration,
    });
    expect(privateRegistration.statusCode).toBe(201);

    const after = new Database(config.databasePath, { readonly: true });
    try {
      for (const table of ["user", "account", "session"] as const) {
        const row = after.prepare(`SELECT count(*) AS count FROM "${table}"`).get() as {
          count: number;
        };
        expect(row.count, table).toBe(1);
      }
    } finally {
      after.close();
    }
  });

  it("rejects registration without the recovery acknowledgement", async () => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: { username: "trade_user", password: "correct-horse-battery-staple" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects a foreign origin without reflecting it", async () => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: {
        ...sameOriginHeaders,
        origin: "https://foreign-origin-sentinel.example",
      },
      payload: validRegistration,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "ORIGIN_REJECTED" } });
    expect(response.body).not.toContain("foreign-origin-sentinel");
  });

  it("registers a username without accepting or storing a source email", async () => {
    const { app, config } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: validRegistration,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      user: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u), username: "trade_user" },
      recoveryAvailable: false,
    });
    expect(response.body).not.toContain("@users.opentrad.invalid");
    expect(response.body).not.toContain('"email"');
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(String(setCookie)).toContain("HttpOnly");
    expect(String(setCookie)).toContain("SameSite=Lax");
    expect(String(setCookie)).toContain("Secure");
    expect(String(setCookie)).toContain("Path=/");
    expect(String(setCookie)).not.toContain("Domain=");

    const database = new Database(config.databasePath, { readonly: true });
    try {
      const stored = database.prepare('SELECT email, username FROM "user"').get() as {
        email: string;
        username: string;
      };
      expect(stored.username).toBe("trade_user");
      expect(stored.email).toMatch(/^[A-Za-z0-9_-]{24}@users\.opentrad\.invalid$/u);
      expect(stored.email).not.toContain("trade_user");
    } finally {
      database.close();
    }
  });

  it.each([
    ["weak password", { ...validRegistration, password: "too-short" }],
    ["missing acknowledgement", { username: "trade_user", password: validRegistration.password }],
    ["unknown field", { ...validRegistration, email: "source-email-sentinel@example.com" }],
    ["malformed body", [validRegistration]],
  ])("returns the fixed invalid-request error for %s", async (_name, payload) => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(response.body).not.toContain("source-email-sentinel");
  });

  it("returns the same non-enumerating error for duplicate and invalid registrations", async () => {
    const { app } = await appForTest();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: validRegistration,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: validRegistration,
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: { ...validRegistration, password: "short" },
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.body).toBe(invalid.body);
    expect(duplicate.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  });

  it.each([
    ["missing origin", { host: "opentrad.example", "sec-fetch-site": "same-origin" }],
    ["missing fetch metadata", { host: "opentrad.example", origin: publicOrigin }],
    ["cross-site fetch metadata", { ...sameOriginHeaders, "sec-fetch-site": "cross-site" }],
    ["noncanonical origin", { ...sameOriginHeaders, origin: `${publicOrigin}/` }],
    ["credentialed origin", { ...sameOriginHeaders, origin: "https://user@opentrad.example" }],
    ["wrong host", { ...sameOriginHeaders, host: "foreign-host-sentinel.example" }],
    ["noncanonical host", { ...sameOriginHeaders, host: "opentrad.example:443" }],
  ])("fails closed for %s", async (_name, headers) => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers,
      payload: validRegistration,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "ORIGIN_REJECTED" } });
    expect(response.body).not.toContain("sentinel");
  });

  it("ignores all forwarding metadata from an untrusted socket", async () => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: {
        ...sameOriginHeaders,
        forwarded: "for=malicious;host=foreign.example;proto=http",
        "x-forwarded-for": "203.0.113.8",
        "x-forwarded-host": "foreign.example",
        "x-forwarded-port": "81",
        "x-forwarded-proto": "http",
      },
      payload: validRegistration,
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("minimal deterministic HTTP behavior", () => {
  it("serves GET and HEAD health without permissive CORS", async () => {
    const { app } = await appForTest();
    const get = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "opentrad.example" },
    });
    const head = await app.inject({
      method: "HEAD",
      url: "/api/health",
      headers: { host: "opentrad.example" },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ status: "ok" });
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
  });

  it("serves readiness only after a successful SQLite probe", async () => {
    const { app } = await appForTest();
    const get = await app.inject({
      method: "GET",
      url: "/api/health/ready",
      headers: { host: "opentrad.example" },
    });
    const head = await app.inject({
      method: "HEAD",
      url: "/api/health/ready",
      headers: { host: "opentrad.example" },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ status: "ready" });
    expect(get.body).not.toContain("sqlite");
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
  });

  it("accepts only same-origin preflight for known routes and sends no CORS grant", async () => {
    const { app } = await appForTest();
    const accepted = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/register",
      headers: {
        ...sameOriginHeaders,
        "access-control-request-method": "POST",
      },
    });
    const rejected = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/register",
      headers: {
        ...sameOriginHeaders,
        origin: "https://foreign-preflight-sentinel.example",
        "sec-fetch-site": "cross-site",
        "access-control-request-method": "POST",
      },
    });

    expect(accepted.statusCode).toBe(204);
    expect(accepted.body).toBe("");
    expect(accepted.headers["access-control-allow-origin"]).toBeUndefined();
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({ error: { code: "ORIGIN_REJECTED" } });
  });

  it("returns fixed 404 and 405 responses", async () => {
    const { app } = await appForTest();
    const missing = await app.inject({
      method: "GET",
      url: "/api/not-found-sentinel",
      headers: { host: "opentrad.example" },
    });
    const wrongMethod = await app.inject({
      method: "PUT",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: validRegistration,
    });
    const authHead = await app.inject({
      method: "HEAD",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(missing.body).not.toContain("not-found-sentinel");
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(authHead.statusCode).toBe(405);
    expect(authHead.body).toBe("");
  });

  it("rejects unsupported content types and oversized registration bodies", async () => {
    const { app } = await appForTest();
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: { ...sameOriginHeaders, "content-type": "text/plain" },
      payload: JSON.stringify(validRegistration),
    });
    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: sameOriginHeaders,
      payload: { ...validRegistration, username: `trade_${"x".repeat(5_000)}` },
    });

    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects prototype-pollution JSON as the same fixed invalid request", async () => {
    const { app } = await appForTest();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: { ...sameOriginHeaders, "content-type": "application/json" },
      payload:
        '{"username":"trade_user","password":"correct-horse-battery-staple","acknowledgements":{"noPasswordRecovery":true},"__proto__":{"polluted":true}}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("bounds repeated registration attempts", async () => {
    const { app } = await appForTest();
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: sameOriginHeaders,
        payload: { ...validRegistration, username: `trade_${index}` },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });
});
