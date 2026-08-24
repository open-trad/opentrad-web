import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { requireSession } from "../src/auth/sessionGuard.js";
import { type ApiConfig, loadConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { buildServer, listenHostForConfig, type ServerDependencies } from "../src/server.js";

const liveApps: FastifyInstance[] = [];
const temporaryRoots: string[] = [];
const discardLogStream = { write(_line: string): void {} };
const origin = "https://opentrad.example";
const stateChangingHeaders = {
  host: "opentrad.example",
  origin,
  "sec-fetch-site": "same-origin",
};

function testConfig(overrides: Readonly<Record<string, string | undefined>> = {}): ApiConfig {
  const root = mkdtempSync(join(tmpdir(), "opentrad-task7-auth-"));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const databasePath = join(root, "opentrad.sqlite");
  applyMigrations(databasePath);
  return loadConfig({
    NODE_ENV: "test",
    OPENTRAD_PUBLIC_ORIGIN: origin,
    BETTER_AUTH_SECRET: "b".repeat(48),
    OPENTRAD_DATABASE_PATH: databasePath,
    OPENTRAD_JOB_ROOT: join(root, "jobs"),
    OPENTRAD_CLAMD_HOST: "127.0.0.1",
    OPENTRAD_CLAMD_PORT: "3310",
    ...overrides,
  });
}

async function appForTest(dependencies?: ServerDependencies): Promise<FastifyInstance> {
  return (await appAndConfig(dependencies)).app;
}

async function appAndConfig(
  dependencies?: ServerDependencies,
): Promise<{ readonly app: FastifyInstance; readonly config: ApiConfig }> {
  const config = testConfig();
  const app = await buildServer(config, dependencies);
  liveApps.push(app);
  return { app, config };
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

afterEach(async () => {
  for (const app of liveApps.splice(0)) await app.close();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("real Better Auth username lifecycle", () => {
  it("starts the configured GitHub OAuth flow through the guarded bridge", async () => {
    const app = await buildServer(
      testConfig({
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
      }),
    );
    liveApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: {
        callbackURL: `${origin}/convert`,
        provider: "github",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.redirect).toBe(true);
    expect(body.url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/u);
    expect(response.headers.location).toBe(body.url);
    expect(response.headers["set-cookie"]).toEqual([
      expect.stringMatching(
        /^__Secure-opentrad\.state=[^;]+; Max-Age=300; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
      ),
    ]);
  });

  it("rejects client-requested GitHub scopes beyond the fixed account profile", async () => {
    const app = await buildServer(
      testConfig({
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
      }),
    );
    liveApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: {
        callbackURL: `${origin}/convert`,
        provider: "github",
        scopes: ["repo"],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("registers, logs out, logs in by username, reads a session, and logs out", async () => {
    const app = await appForTest();
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: stateChangingHeaders,
      payload: {
        acknowledgements: { noPasswordRecovery: true },
        password: "correct-horse-battery-staple",
        username: "session_user",
      },
    });
    expect(registration.statusCode).toBe(201);

    const registrationCookie = cookieHeader(registration);
    const firstSession = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example", cookie: registrationCookie },
    });
    expect(firstSession.statusCode).toBe(200);
    expect(firstSession.json().user.username).toBe("session_user");
    expect(firstSession.body).not.toContain("@users.opentrad.invalid");
    expect(firstSession.body).not.toContain('"email"');

    const firstLogout = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: {
        ...stateChangingHeaders,
        cookie: registrationCookie,
        "content-type": "application/json",
      },
      payload: "{}",
    });
    expect(firstLogout.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: stateChangingHeaders,
      payload: { password: "correct-horse-battery-staple", username: "session_user" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.body).not.toContain("@users.opentrad.invalid");
    expect(login.body).not.toContain('"email"');

    const loginCookie = cookieHeader(login);
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example", cookie: loginCookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.username).toBe("session_user");
    expect(session.body).not.toContain("@users.opentrad.invalid");
    expect(session.body).not.toContain('"email"');

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { ...stateChangingHeaders, cookie: loginCookie, "content-type": "application/json" },
      payload: "{}",
    });
    expect(logout.statusCode).toBe(200);

    const ended = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example", cookie: loginCookie },
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toBeNull();
  });

  it("returns a fixed response for bad credentials and absent OAuth providers", async () => {
    const app = await appForTest();
    const invalidLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: stateChangingHeaders,
      payload: { password: "incorrect-password-sentinel", username: "unknown-user-sentinel" },
    });
    const absentOauth = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: { provider: "github" },
    });

    expect(invalidLogin.statusCode).toBe(400);
    expect(invalidLogin.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(absentOauth.statusCode).toBe(400);
    expect(absentOauth.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(`${invalidLogin.body}${absentOauth.body}`).not.toContain("sentinel");
  });

  it("deletes a password account and invalidates its existing session", async () => {
    const { app, config } = await appAndConfig();
    const password = "correct-horse-battery-staple";
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: stateChangingHeaders,
      payload: {
        acknowledgements: { noPasswordRecovery: true },
        password,
        username: "delete_user",
      },
    });
    expect(registration.statusCode).toBe(201);
    const cookie = cookieHeader(registration);
    const activeSession = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example", cookie },
    });
    const userId = activeSession.json().user.id as string;
    const inspection = new Database(config.databasePath);
    inspection
      .prepare("INSERT INTO daily_usage (owner_id, utc_day, accepted_count) VALUES (?, ?, ?)")
      .run(userId, "2026-08-22", 3);
    const jobId = "00000000-0000-4000-8000-000000000001";
    inspection
      .prepare(
        `INSERT INTO jobs
          (id, owner_id, operation, input_format, output_format, quality, status, input_bytes,
           created_at, expires_at, result_media_type, result_bytes)
         VALUES (?, ?, 'structured.convert', 'md', 'docx', 'B', 'succeeded', 64,
           1, 2, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 3)`,
      )
      .run(jobId, userId);
    inspection
      .prepare(
        `INSERT INTO idempotency
          (owner_id, key_hmac, operation, input_format, output_format, input_bytes, job_id,
           expires_at, request_shape)
         VALUES (?, ?, 'structured.convert', 'md', 'docx', 64, ?, 2, '{}')`,
      )
      .run(userId, "a".repeat(43), jobId);
    const resultDirectory = join(config.jobRoot, "done", jobId);
    mkdirSync(resultDirectory, { mode: 0o700 });
    writeFileSync(join(resultDirectory, "result.bin"), "PK\n", { mode: 0o600 });

    const deletion = await app.inject({
      method: "POST",
      url: "/api/auth/delete-user",
      headers: {
        ...stateChangingHeaders,
        cookie,
        "content-type": "application/json",
      },
      payload: { password },
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toEqual({ success: true, message: "User deleted" });
    const privateRowsAfterDeletion = Object.fromEntries(
      ["daily_usage", "idempotency", "jobs"].map((table) => [
        table,
        inspection.prepare(`SELECT count(*) AS count FROM ${table} WHERE owner_id = ?`).get(userId),
      ]),
    );
    inspection.close();
    expect(privateRowsAfterDeletion).toEqual({
      daily_usage: { count: 0 },
      idempotency: { count: 0 },
      jobs: { count: 0 },
    });
    expect(existsSync(resultDirectory)).toBe(false);

    const ended = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example", cookie },
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toBeNull();
  });
});

describe("byte-exact Better Auth bridge", () => {
  it("preserves method, query, and request body bytes", async () => {
    const seen: Array<{ body: string; method: string; url: string }> = [];
    const rawBody = '{ "username" : "byte_sentinel", "password" : "p" }';
    const dependencies = {
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async (request: Request) => {
          seen.push({
            body: Buffer.from(await request.arrayBuffer()).toString("utf8"),
            method: request.method,
            url: request.url,
          });
          return new Response('{"ok":true}', {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        },
      },
    } satisfies ServerDependencies;
    const app = await appForTest(dependencies);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username?returnTo=%2Fquotes&mode=exact",
      headers: { ...stateChangingHeaders, "content-type": "application/json" },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toEqual([
      {
        body: rawBody,
        method: "POST",
        url: `${origin}/api/auth/sign-in/username?returnTo=%2Fquotes&mode=exact`,
      },
    ]);
  });

  it("preserves repeated Set-Cookie headers without broadening cookie scope", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "first=one; Path=/; HttpOnly; Secure; SameSite=Lax");
    headers.append("set-cookie", "second=two; Path=/; HttpOnly; Secure; SameSite=Strict");
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response("{}", { headers, status: 200 }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.headers["set-cookie"]).toEqual([
      "first=one; Path=/; HttpOnly; Secure; SameSite=Lax",
      "second=two; Path=/; HttpOnly; Secure; SameSite=Strict",
    ]);
    expect(String(response.headers["set-cookie"])).not.toContain("Domain=");
  });

  it("forwards an empty JSON OAuth callback redirect with its state and session cookies", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      location: "https://opentrad.example/dashboard",
    });
    headers.append(
      "set-cookie",
      "better-auth.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "better-auth.session_token=session-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response(null, { headers, status: 302 }),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/github?code=opaque-code&state=opaque-state",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.body).toBe("");
    expect(response.headers.location).toBe("https://opentrad.example/dashboard");
    expect(response.headers["set-cookie"]).toEqual([
      "better-auth.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
      "better-auth.session_token=session-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  it("fails closed for a nonempty invalid JSON OAuth callback redirect", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response("{", {
            headers: { "content-type": "application/json", location: "/dashboard" },
            status: 302,
          }),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/github?code=opaque-code&state=opaque-state",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
  });

  it("fails closed for an external OAuth callback redirect without exposing its cookies", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      location: "https://attacker.example/callback",
    });
    headers.append(
      "set-cookie",
      "better-auth.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "better-auth.session_token=session-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response(null, { headers, status: 302 }),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/github?code=opaque-code&state=opaque-state",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("fails closed for a same-origin protocol-relative OAuth callback redirect", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      location: "//opentrad.example/dashboard",
    });
    headers.append(
      "set-cookie",
      "better-auth.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "better-auth.session_token=session-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response(null, { headers, status: 302 }),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/github?code=opaque-code&state=opaque-state",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("fails closed when a social response redirects to a same-origin non-GitHub URL", async () => {
    const location = `${origin}/convert`;
    const headers = new Headers({
      "content-type": "application/json",
      location,
    });
    headers.append(
      "set-cookie",
      "__Secure-opentrad.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await buildServer(
      testConfig({
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
      }),
      {
        auth: {
          api: {
            getSession: async () => null,
            signUpEmail: async () => {
              throw new Error("unused");
            },
          },
          handler: async () =>
            new Response(JSON.stringify({ redirect: true, url: location }), {
              headers,
              status: 200,
            }),
        },
      },
    );
    liveApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: { callbackURL: `${origin}/convert`, provider: "github" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("fails closed for a GitHub-shaped social redirect with the wrong client id", async () => {
    const location = new URL("https://github.com/login/oauth/authorize");
    location.searchParams.set("response_type", "code");
    location.searchParams.set("client_id", "attacker-client-id");
    location.searchParams.set("state", "opaque-state");
    location.searchParams.set("redirect_uri", `${origin}/api/auth/callback/github`);
    location.searchParams.set("code_challenge_method", "S256");
    location.searchParams.set("code_challenge", "opaque-challenge");
    const headers = new Headers({
      "content-type": "application/json",
      location: location.toString(),
    });
    headers.append(
      "set-cookie",
      "__Secure-opentrad.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await buildServer(
      testConfig({
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
      }),
      {
        auth: {
          api: {
            getSession: async () => null,
            signUpEmail: async () => {
              throw new Error("unused");
            },
          },
          handler: async () =>
            new Response(JSON.stringify({ redirect: true, url: location.toString() }), {
              headers,
              status: 200,
            }),
        },
      },
    );
    liveApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: { callbackURL: `${origin}/convert`, provider: "github" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("fails closed when the social redirect body disagrees with its safe GitHub Location", async () => {
    const location = new URL("https://github.com/login/oauth/authorize");
    location.searchParams.set("response_type", "code");
    location.searchParams.set("client_id", "github-client-id");
    location.searchParams.set("state", "opaque-state");
    location.searchParams.set("redirect_uri", `${origin}/api/auth/callback/github`);
    location.searchParams.set("code_challenge_method", "S256");
    location.searchParams.set("code_challenge", "opaque-challenge");
    const headers = new Headers({
      "content-type": "application/json",
      location: location.toString(),
    });
    headers.append(
      "set-cookie",
      "__Secure-opentrad.state=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const app = await buildServer(
      testConfig({
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
      }),
      {
        auth: {
          api: {
            getSession: async () => null,
            signUpEmail: async () => {
              throw new Error("unused");
            },
          },
          handler: async () =>
            new Response(
              JSON.stringify({ redirect: true, url: "https://attacker.example/authorize" }),
              { headers, status: 200 },
            ),
        },
      },
    );
    liveApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: stateChangingHeaders,
      payload: { callbackURL: `${origin}/convert`, provider: "github" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects cookies whose values imitate required security attributes", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append(
      "set-cookie",
      "session=contains-secure; Path=/too-broad; HttpOnly; SameSite=Lax",
    );
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response("{}", { headers, status: 200 }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
  });

  it("sanitizes JSON auth responses with an explicit UTF-8 charset", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response(
            '{"user":{"email":"charset-alias@users.opentrad.invalid","username":"safe_user"}}',
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          ),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { username: "safe_user" } });
    expect(response.body).not.toContain("@users.opentrad.invalid");
    expect(response.body).not.toContain('"email"');
  });

  it.each([
    'Application/JSON ; Charset = "UTF-8"',
    "application/problem+json; charset=Utf-8",
    "application/vnd.opentrad.session+json",
  ])("strictly parses equivalent JSON response media type %s", async (contentType) => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response(
            '{"user":{"email":"mime-alias@users.opentrad.invalid","username":"safe_user"}}',
            { headers: { "content-type": contentType }, status: 200 },
          ),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { username: "safe_user" } });
    expect(response.body).not.toContain("@users.opentrad.invalid");
  });

  it.each([
    "application/json; charset=iso-8859-1",
    "application/json; charset",
    `application/json;${" ".repeat(300)}charset=utf-8`,
  ])("fails closed for invalid JSON response media type %s", async (contentType) => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response("{}", { headers: { "content-type": contentType }, status: 200 }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
  });

  it("fails closed when an internal alias survives in a non-email JSON field", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response('{"name":"survivor@users.opentrad.invalid"}', {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("survivor");
  });

  it("fails closed when a non-JSON success response contains an internal alias", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response("non-json-alias@users.opentrad.invalid", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.body).not.toContain("non-json-alias");
  });

  it("forwards only validated Better Auth response headers", async () => {
    const headers = new Headers({
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": "https://cors-sentinel.example",
      "cache-control": "no-store",
      connection: "x-hop-sentinel",
      "content-type": "application/json",
      "keep-alive": "timeout=5",
      location: "/api/auth/callback/github",
      "proxy-authenticate": "Basic proxy-secret-sentinel",
      te: "trailers",
      "x-hop-sentinel": "must-not-forward",
    });
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => new Response("{}", { headers, status: 200 }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.location).toBe("/api/auth/callback/github");
    expect(response.headers.connection).not.toBe("x-hop-sentinel");
    expect(response.headers["keep-alive"]).not.toBe("timeout=5");
    for (const name of [
      "access-control-allow-credentials",
      "access-control-allow-origin",
      "proxy-authenticate",
      "te",
      "x-hop-sentinel",
    ]) {
      expect(response.headers[name], name).toBeUndefined();
    }
  });

  it("maps handler rejection to a fixed finite response without leaking causes", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => {
          throw new Error("handler-rejection-secret-sentinel");
        },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(response.body).not.toContain("handler-rejection-secret-sentinel");
    expect(response.body.length).toBeLessThan(100);
  });

  it("bounds a handler that never settles", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => await new Promise<Response>(() => undefined),
      },
      authHandlerTimeoutMs: 20,
    });
    const startedAt = Date.now();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("bounds a response body that never settles", async () => {
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () =>
          new Response(
            new ReadableStream({
              start() {
                // Intentionally never enqueue or close.
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
      },
      authHandlerTimeoutMs: 20,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "opentrad.example" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST", retryable: true } });
  }, 1_000);

  it("aborts the Web Request when the HTTP client closes", async () => {
    let observeAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      observeAbort = resolve;
    });
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async (request) =>
          await new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => {
                observeAbort?.();
                reject(new Error("client-close-secret-sentinel"));
              },
              { once: true },
            );
          }),
      },
      authHandlerTimeoutMs: 2_000,
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const port = Number(new URL(address).port);

    await new Promise<void>((resolve) => {
      const client = httpRequest({
        headers: {
          ...stateChangingHeaders,
          "content-length": "2",
          "content-type": "application/json",
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/api/auth/sign-in/username",
        port,
      });
      client.on("error", () => resolve());
      client.end("{}", () => client.destroy());
    });

    await Promise.race([
      aborted,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("abort not observed")), 1_000),
      ),
    ]);
  });

  it("bounds auth content types, bodies, missing origins, and request rate", async () => {
    const app = await appForTest();
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: { ...stateChangingHeaders, "content-type": "text/plain" },
      payload: "{}",
    });
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: { host: "opentrad.example", "content-type": "application/json" },
      payload: "{}",
    });
    const oversized = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: stateChangingHeaders,
      payload: { padding: "x".repeat(17_000) },
    });
    const rateApp = await appForTest();
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      const response = await rateApp.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { host: "opentrad.example" },
      });
      statuses.push(response.statusCode);
    }

    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json()).toEqual({ error: { code: "ORIGIN_REJECTED" } });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("never logs authorization, cookies, bodies, aliases, usernames, ids, or thrown secrets", async () => {
    const lines: string[] = [];
    const app = await appForTest({
      auth: {
        api: {
          getSession: async () => null,
          signUpEmail: async () => {
            throw new Error("unused");
          },
        },
        handler: async () => {
          throw new Error("thrown-secret-sentinel");
        },
      },
      logStream: { write: (line: string) => lines.push(line) },
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      headers: {
        ...stateChangingHeaders,
        authorization: "Bearer authorization-secret-sentinel",
        cookie: "session=cookie-secret-sentinel",
        "content-type": "application/json",
      },
      payload: {
        email: "alias-secret-sentinel@users.opentrad.invalid",
        id: "user-id-secret-sentinel",
        password: "password-secret-sentinel",
        username: "username-secret-sentinel",
      },
    });

    const captured = lines.join("");
    for (const sentinel of [
      "authorization-secret-sentinel",
      "cookie-secret-sentinel",
      "alias-secret-sentinel",
      "user-id-secret-sentinel",
      "password-secret-sentinel",
      "username-secret-sentinel",
      "thrown-secret-sentinel",
    ]) {
      expect(captured).not.toContain(sentinel);
    }
  });
});

describe("production listener and explicit proxy trust", () => {
  it("starts built dist with the child's native process.env and serves health", () => {
    const repositoryRoot = join(import.meta.dirname, "../../..");
    execFileSync("pnpm", ["--filter", "@opentrad/api", "build"], {
      cwd: repositoryRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
    const configUrl = pathToFileURL(join(repositoryRoot, "apps/api/dist/config.js")).href;
    const serverUrl = pathToFileURL(join(repositoryRoot, "apps/api/dist/server.js")).href;
    const script = `
      const { loadConfig } = await import(${JSON.stringify(configUrl)});
      const { buildServer, listenHostForConfig } = await import(${JSON.stringify(serverUrl)});
      const { request } = await import("node:http");
      let app;
      try {
        const config = loadConfig(process.env);
        app = await buildServer(config, { logStream: { write() {} } });
        const address = await app.listen({ host: listenHostForConfig(config), port: 0 });
        const target = new URL(address);
        const response = await new Promise((resolve, reject) => {
          const client = request({
            headers: { host: "opentrad.example" },
            hostname: target.hostname,
            method: "GET",
            path: "/api/health",
            port: target.port,
          }, (incoming) => {
            const chunks = [];
            incoming.on("data", (chunk) => chunks.push(chunk));
            incoming.on("end", () => resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              status: incoming.statusCode,
            }));
          });
          client.on("error", reject);
          client.end();
        });
        if (response.status !== 200 || response.body !== '{"status":"ok"}') throw new Error();
        process.stdout.write("NATIVE_STARTUP_OK\\n");
      } catch {
        process.stderr.write("API_START_FAILED\\n");
        process.exitCode = 1;
      } finally {
        if (app) await app.close();
      }
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        BETTER_AUTH_SECRET: "n".repeat(48),
        NODE_ENV: "test",
        OPENTRAD_CLAMD_HOST: "127.0.0.1",
        OPENTRAD_CLAMD_PORT: "3310",
        OPENTRAD_DATABASE_PATH: ":memory:",
        OPENTRAD_JOB_ROOT: "/tmp/opentrad-native-startup",
        OPENTRAD_PUBLIC_ORIGIN: origin,
      },
      maxBuffer: 64 * 1_024,
      timeout: 10_000,
    });

    expect(child.status).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.stdout).toBe("NATIVE_STARTUP_OK\n");
    expect(child.stderr).not.toContain("API_START_FAILED");
  }, 45_000);

  it("binds production on all container interfaces while non-production stays loopback", async () => {
    const production = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(production, { logStream: discardLogStream });
    liveApps.push(app);
    const host = listenHostForConfig(production);
    const address = await app.listen({ host, port: 0 });
    const port = Number(new URL(address).port);

    const response = await new Promise<{ body: string; statusCode: number | undefined }>(
      (resolve, reject) => {
        const client = httpRequest(
          {
            headers: { host: "opentrad.example" },
            host: "127.0.0.1",
            method: "GET",
            path: "/api/health",
            port,
          },
          (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
            incoming.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                statusCode: incoming.statusCode,
              }),
            );
          },
        );
        client.on("error", reject);
        client.end();
      },
    );

    expect(host).toBe("0.0.0.0");
    expect(response).toEqual({ body: '{"status":"ok"}', statusCode: 200 });
    expect(listenHostForConfig(testConfig())).toBe("127.0.0.1");
  });

  it("gives distinct trusted XFF clients independent registration quotas", async () => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const statuses = new Map<string, number[]>();
    for (const clientIp of ["198.51.100.10", "198.51.100.11"]) {
      const clientStatuses: number[] = [];
      for (let index = 0; index < 6; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/register",
          headers: {
            ...stateChangingHeaders,
            "x-forwarded-for": clientIp,
            "x-forwarded-host": "opentrad.example",
            "x-forwarded-proto": "https",
          },
          payload: {
            acknowledgements: { noPasswordRecovery: true },
            password: "correct-horse-battery-staple",
            username: `trusted_${clientIp.endsWith("10") ? "a" : "b"}_${index}`,
          },
          remoteAddress: "127.0.0.1",
        });
        clientStatuses.push(response.statusCode);
      }
      statuses.set(clientIp, clientStatuses);
    }

    expect(statuses.get("198.51.100.10")).toEqual([201, 201, 201, 201, 201, 429]);
    expect(statuses.get("198.51.100.11")).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("cannot reset quota with XFF spoofing from an untrusted remote", async () => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: {
          ...stateChangingHeaders,
          "x-forwarded-for": `198.51.100.${index + 20}`,
        },
        payload: {
          acknowledgements: { noPasswordRecovery: true },
          password: "correct-horse-battery-staple",
          username: `untrusted_${index}`,
        },
        remoteAddress: "192.0.2.44",
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("uses the real rightmost client and rejects private or invalid forwarded quota keys", async () => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const chainStatuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: {
          ...stateChangingHeaders,
          "x-forwarded-for": `10.0.0.${index + 1}, 198.51.100.50`,
          "x-forwarded-host": "opentrad.example",
          "x-forwarded-proto": "https",
        },
        payload: {
          acknowledgements: { noPasswordRecovery: true },
          password: "correct-horse-battery-staple",
          username: `chain_${index}`,
        },
        remoteAddress: "127.0.0.1",
      });
      chainStatuses.push(response.statusCode);
    }
    expect(chainStatuses).toEqual([201, 201, 201, 201, 201, 429]);

    const privateStatuses: number[] = [];
    const privateConfig = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const privateApp = await buildServer(privateConfig, { logStream: discardLogStream });
    liveApps.push(privateApp);
    for (let index = 0; index < 6; index += 1) {
      const response = await privateApp.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: {
          ...stateChangingHeaders,
          "x-forwarded-for": index % 2 === 0 ? `10.0.0.${index + 1}` : `invalid-${index}`,
          "x-forwarded-host": "opentrad.example",
          "x-forwarded-proto": "https",
        },
        payload: {
          acknowledgements: { noPasswordRecovery: true },
          password: "correct-horse-battery-staple",
          username: `private_${index}`,
        },
        remoteAddress: "127.0.0.1",
      });
      privateStatuses.push(response.statusCode);
    }
    expect(privateStatuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it.each([
    ["IPv4 mapped", ["192.0.2.44", "::ffff:192.0.2.44"]],
    ["expanded IPv6", ["2001:db8::44", "2001:0db8:0:0:0:0:0:44"]],
  ])("shares one direct quota bucket for semantic %s address forms", async (_name, addresses) => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: {
          ...stateChangingHeaders,
          "x-forwarded-for": `198.51.100.${index + 70}`,
        },
        payload: {
          acknowledgements: { noPasswordRecovery: true },
          password: "correct-horse-battery-staple",
          username: `canonical_${_name.replaceAll(" ", "_")}_${index}`,
        },
        remoteAddress: addresses[index % addresses.length],
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("recognizes an IPv4-mapped socket inside an explicit IPv4 trusted proxy CIDR", async () => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/register",
        headers: {
          ...stateChangingHeaders,
          "x-forwarded-for": "198.51.100.90",
          "x-forwarded-host": "opentrad.example",
          "x-forwarded-proto": "https",
        },
        payload: {
          acknowledgements: { noPasswordRecovery: true },
          password: "correct-horse-battery-staple",
          username: `mapped_proxy_${index}`,
        },
        remoteAddress: "::ffff:127.0.0.1",
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it.each([
    { "x-forwarded-host": "foreign.example" },
    { "x-forwarded-proto": "http" },
    { forwarded: "for=198.51.100.1;proto=https" },
    { "x-forwarded-port": "443" },
  ])("rejects invalid trusted forwarding metadata %j", async (forwardedHeaders) => {
    const config = testConfig({
      NODE_ENV: "production",
      OPENTRAD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
    });
    const app = await buildServer(config, { logStream: discardLogStream });
    liveApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/register",
      headers: {
        ...stateChangingHeaders,
        ...forwardedHeaders,
        "x-forwarded-for": "198.51.100.100",
      },
      payload: {
        acknowledgements: { noPasswordRecovery: true },
        password: "correct-horse-battery-staple",
        username: "bad_forwarding",
      },
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "ORIGIN_REJECTED" } });
  });
});

describe("future protected-route session guard", () => {
  it("returns only immutable session and owner ids", async () => {
    const guarded = await requireSession({ headers: { cookie: "session=opaque" } } as never, {
      api: {
        getSession: async () => ({
          session: { id: "session-id" },
          user: { email: "alias@users.opentrad.invalid", id: "user-id", username: "private" },
        }),
      },
    });

    expect(guarded).toEqual({ sessionId: "session-id", userId: "user-id" });
    expect(Object.getPrototypeOf(guarded)).toBeNull();
    expect(Object.isFrozen(guarded)).toBe(true);
    expect(guarded).not.toHaveProperty("email");
    expect(guarded).not.toHaveProperty("username");
  });

  it("fails closed for absent and accessor-backed sessions without invoking accessors", async () => {
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "session", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { id: "attacker" };
      },
    });

    for (const result of [null, hostile]) {
      await expect(
        requireSession({ headers: {} } as never, { api: { getSession: async () => result } }),
      ).rejects.toThrow("AUTH_REQUIRED");
    }
    expect(getterCalls).toBe(0);
  });
});
