import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { SocketAddress } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegisterRequestSchema } from "@opentrad/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAuth,
  createAuthOptions,
  createInternalEmailAlias,
  type OpenTradAuthOptions,
} from "../src/auth/auth.js";
import { loadConfig } from "../src/config.js";

const DATABASES: Array<{ close(): void }> = [];

function validEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    OPENTRAD_PUBLIC_ORIGIN: "https://opentrad.example",
    BETTER_AUTH_SECRET: "a".repeat(48),
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-client-secret",
    OPENTRAD_DATABASE_PATH: ":memory:",
    OPENTRAD_JOB_ROOT: "/tmp/opentrad-jobs",
    OPENTRAD_CLAMD_HOST: "127.0.0.1",
    OPENTRAD_CLAMD_PORT: "3310",
    ...overrides,
  };
}

function optionsForTest(): OpenTradAuthOptions {
  const options = createAuthOptions(loadConfig(validEnvironment()));
  const database = options.database;
  if (typeof database === "object" && database !== null && "close" in database) {
    DATABASES.push(database as { close(): void });
  }
  return options;
}

afterEach(() => {
  for (const database of DATABASES.splice(0)) database.close();
});

describe("loadConfig", () => {
  it("keeps the production API environment template aligned with the runtime contract", () => {
    const releasePlan = readFileSync(
      new URL(
        "../../../docs/superpowers/plans/2026-08-19-opentrad-production-release.md",
        import.meta.url,
      ),
      "utf8",
    );
    const template = releasePlan.match(
      /Create `infra\/runtime\/api\.env\.example`:\n\n~~~dotenv\n([\s\S]*?)\n~~~/u,
    )?.[1];

    expect(template).toBeDefined();
    for (const name of [
      "OPENTRAD_PUBLIC_ORIGIN",
      "OPENTRAD_TRUSTED_PROXY_CIDR",
      "OPENTRAD_DATABASE_PATH",
      "OPENTRAD_JOB_ROOT",
      "OPENTRAD_CLAMD_HOST",
      "OPENTRAD_CLAMD_PORT",
    ]) {
      expect(template).toMatch(new RegExp(`^${name}=`, "mu"));
    }
    expect(template).toContain(
      "OPENTRAD_TRUSTED_PROXY_CIDR=REPLACE_WITH_EXACT_CONTAINER_OBSERVED_PROXY_CIDR",
    );
    expect(template).not.toMatch(
      /^(?:BETTER_AUTH_URL|TRUSTED_ORIGINS|AUTH_DATABASE_PATH|JOB_ROOT|CLAMD_HOST|CLAMD_PORT)=/mu,
    );
    expect(releasePlan).toContain(
      "Task 15 production preflight must replace the deliberately invalid placeholder",
    );
  });

  it.each(["development", "test", "production"] as const)(
    "requires and preserves the explicit %s environment",
    (nodeEnvironment) => {
      const config = loadConfig(
        validEnvironment({
          NODE_ENV: nodeEnvironment,
          ...(nodeEnvironment === "production"
            ? { OPENTRAD_TRUSTED_PROXY_CIDR: "172.30.0.0/24" }
            : {}),
        }),
      );

      expect(config).toEqual({
        nodeEnv: nodeEnvironment,
        publicOrigin: "https://opentrad.example",
        betterAuthSecret: "a".repeat(48),
        githubClientId: "github-client-id",
        githubClientSecret: "github-client-secret",
        databasePath: ":memory:",
        jobRoot: "/tmp/opentrad-jobs",
        clamdHost: "127.0.0.1",
        clamdPort: 3310,
        trustedProxyCidr: nodeEnvironment === "production" ? "172.30.0.0/24" : null,
      });
    },
  );

  it("has no defaults and requires every application setting", () => {
    const requiredNames = [
      "NODE_ENV",
      "OPENTRAD_PUBLIC_ORIGIN",
      "BETTER_AUTH_SECRET",
      "OPENTRAD_DATABASE_PATH",
      "OPENTRAD_JOB_ROOT",
      "OPENTRAD_CLAMD_HOST",
      "OPENTRAD_CLAMD_PORT",
    ] as const;

    for (const name of requiredNames) {
      const environment = validEnvironment();
      delete environment[name];
      expect(() => loadConfig(environment), name).toThrow("Invalid API configuration");
    }
  });

  it("allows GitHub OAuth to be explicitly absent", () => {
    const environment = validEnvironment();
    delete environment.GITHUB_CLIENT_ID;
    delete environment.GITHUB_CLIENT_SECRET;

    expect(loadConfig(environment)).toEqual({
      nodeEnv: "test",
      publicOrigin: "https://opentrad.example",
      betterAuthSecret: "a".repeat(48),
      githubClientId: null,
      githubClientSecret: null,
      databasePath: ":memory:",
      jobRoot: "/tmp/opentrad-jobs",
      clamdHost: "127.0.0.1",
      clamdPort: 3310,
      trustedProxyCidr: null,
    });
  });

  it("requires one explicit trusted proxy IP or CIDR only in production", () => {
    expect(loadConfig(validEnvironment()).trustedProxyCidr).toBeNull();
    expect(loadConfig(validEnvironment({ NODE_ENV: "development" })).trustedProxyCidr).toBeNull();
    expect(() => loadConfig(validEnvironment({ NODE_ENV: "production" }))).toThrow(
      "Invalid API configuration",
    );
    expect(
      loadConfig(
        validEnvironment({
          NODE_ENV: "production",
          OPENTRAD_TRUSTED_PROXY_CIDR: "172.30.0.7",
        }),
      ).trustedProxyCidr,
    ).toBe("172.30.0.7");
    expect(
      loadConfig(
        validEnvironment({
          NODE_ENV: "production",
          OPENTRAD_TRUSTED_PROXY_CIDR: "fd00:1234::/64",
        }),
      ).trustedProxyCidr,
    ).toBe("fd00:1234::/64");
    expect(
      loadConfig(
        validEnvironment({
          NODE_ENV: "production",
          OPENTRAD_TRUSTED_PROXY_CIDR: "2001:0db8:0:0:0:0:0:1",
        }),
      ).trustedProxyCidr,
    ).toBe("2001:db8::1");
  });

  it("rejects ambiguous, mapped, host-bit, zero and overbroad trusted proxy networks", () => {
    for (const trustedProxyCidr of [
      "172.30.0.7/24",
      "2001:db8::1/64",
      "2001:0db8::/64",
      "::ffff:127.0.0.1",
      "::ffff:127.0.0.1/128",
      "0.0.0.0/32",
      "::/128",
      "10.0.0.0/8",
      "2001:db8::/32",
    ]) {
      expect(() =>
        loadConfig(
          validEnvironment({
            NODE_ENV: "production",
            OPENTRAD_TRUSTED_PROXY_CIDR: trustedProxyCidr,
          }),
        ),
      ).toThrow("Invalid API configuration");
    }
  });

  it("uses captured socket parsing when host prototypes are poisoned later", () => {
    const originalParse = SocketAddress.parse;
    let parsed: string | null | undefined;
    try {
      Object.defineProperty(SocketAddress, "parse", {
        configurable: true,
        value: () => undefined,
        writable: true,
      });
      parsed = loadConfig(
        validEnvironment({
          NODE_ENV: "production",
          OPENTRAD_TRUSTED_PROXY_CIDR: "2001:db8::/64",
        }),
      ).trustedProxyCidr;
    } finally {
      Object.defineProperty(SocketAddress, "parse", {
        configurable: true,
        value: originalParse,
        writable: true,
      });
    }
    expect(parsed).toBe("2001:db8::/64");
  });

  it("rejects half-configured or empty GitHub OAuth settings", () => {
    for (const overrides of [
      { GITHUB_CLIENT_ID: undefined },
      { GITHUB_CLIENT_SECRET: undefined },
      { GITHUB_CLIENT_ID: "" },
      { GITHUB_CLIENT_SECRET: "" },
    ]) {
      expect(() => loadConfig(validEnvironment(overrides))).toThrow("Invalid API configuration");
    }
  });

  it("rejects invalid environments, non-origins, empty values and ambiguous ports", () => {
    for (const overrides of [
      { NODE_ENV: "dev" },
      { NODE_ENV: "staging" },
      { OPENTRAD_PUBLIC_ORIGIN: "https://opentrad.example/path" },
      { OPENTRAD_PUBLIC_ORIGIN: "https://user:pass@opentrad.example" },
      { OPENTRAD_PUBLIC_ORIGIN: "javascript:alert(1)" },
      { BETTER_AUTH_SECRET: "short" },
      { GITHUB_CLIENT_ID: "" },
      { GITHUB_CLIENT_SECRET: "" },
      { OPENTRAD_DATABASE_PATH: "" },
      { OPENTRAD_JOB_ROOT: "" },
      { OPENTRAD_CLAMD_HOST: "" },
      { OPENTRAD_CLAMD_PORT: " 3310" },
      { OPENTRAD_CLAMD_PORT: "3310.0" },
      { OPENTRAD_CLAMD_PORT: "1e3" },
      { OPENTRAD_CLAMD_PORT: "0" },
      { OPENTRAD_CLAMD_PORT: "65536" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "172.30.0.0/33" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "fd00::/129" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "proxy.internal" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "0.0.0.0/0" },
      { OPENTRAD_TRUSTED_PROXY_CIDR: "172.30.0.1,172.30.0.2" },
    ]) {
      expect(() => loadConfig(validEnvironment(overrides)), JSON.stringify(overrides)).toThrow(
        "Invalid API configuration",
      );
    }
  });

  it("allows explicit loopback HTTP only outside production", () => {
    for (const nodeEnvironment of ["development", "test"] as const) {
      for (const publicOrigin of [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
      ]) {
        expect(
          loadConfig(
            validEnvironment({
              NODE_ENV: nodeEnvironment,
              OPENTRAD_PUBLIC_ORIGIN: publicOrigin,
            }),
          ).publicOrigin,
        ).toBe(publicOrigin);
      }
    }

    for (const overrides of [
      { NODE_ENV: "production", OPENTRAD_PUBLIC_ORIGIN: "http://localhost:5173" },
      { NODE_ENV: "test", OPENTRAD_PUBLIC_ORIGIN: "http://opentrad.example" },
    ]) {
      expect(() => loadConfig(validEnvironment(overrides))).toThrow("Invalid API configuration");
    }
  });

  it("ignores unrelated operating-system variables but rejects unknown or legacy app variables", () => {
    expect(loadConfig(validEnvironment({ PATH: "/usr/bin", LANG: "zh_CN.UTF-8" }))).toBeDefined();

    for (const forbidden of [
      "OPENTRAD_UNKNOWN_SETTING",
      "BETTER_AUTH_URL",
      "AUTH_DATABASE_PATH",
      "GITHUB_CLIENT_SECRET_FILE",
      "JOB_DATABASE_PATH",
      "JOB_ROOT",
      "CLAMD_HOST",
      "CLAMD_PORT",
    ]) {
      expect(
        () => loadConfig(validEnvironment({ [forbidden]: "attacker-value" })),
        forbidden,
      ).toThrow("Invalid API configuration");
    }
  });

  it("rejects accessors without invoking them", () => {
    const environment = validEnvironment();
    let getterCalls = 0;
    Object.defineProperty(environment, "OPENTRAD_PUBLIC_ORIGIN", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "https://attacker.example";
      },
    });

    expect(() => loadConfig(environment)).toThrow("Invalid API configuration");
    expect(getterCalls).toBe(0);
  });

  it("fails closed on proxies and never echoes secret values in errors", () => {
    const secret = "do-not-leak-this-secret-".repeat(3);
    const hostile = new Proxy(validEnvironment({ BETTER_AUTH_SECRET: secret }), {
      ownKeys() {
        throw new Error(secret);
      },
    });

    let thrown: unknown;
    try {
      loadConfig(hostile);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toBe("Error: Invalid API configuration");
    expect(String(thrown)).not.toContain(secret);
  });

  it("rejects environment lookalikes with a custom prototype", () => {
    const environment = validEnvironment();
    Object.setPrototypeOf(environment, { inherited: "not-native-process-env" });

    expect(() => loadConfig(environment)).toThrow("Invalid API configuration");
  });

  it("returns an immutable null-prototype configuration snapshot", () => {
    const environment = validEnvironment();
    const config = loadConfig(environment);
    environment.OPENTRAD_PUBLIC_ORIGIN = "https://attacker.example";

    expect(Object.getPrototypeOf(config)).toBeNull();
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.publicOrigin).toBe("https://opentrad.example");
    expect(Reflect.set(config, "publicOrigin", "https://attacker.example")).toBe(false);
  });

  it("is unaffected by poisoned String, Set, Number and Array iteration intrinsics", () => {
    const originalStartsWith = String.prototype.startsWith;
    const originalTrim = String.prototype.trim;
    const originalIncludes = String.prototype.includes;
    const originalSetHas = Set.prototype.has;
    const originalIsSafeInteger = Number.isSafeInteger;
    const originalIterator = Array.prototype[Symbol.iterator];
    let publicOrigin: string | undefined;
    let rejectedUnknown = false;
    try {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        value: () => false,
        writable: true,
      });
      Object.defineProperty(String.prototype, "trim", {
        configurable: true,
        value: () => "attacker",
        writable: true,
      });
      Object.defineProperty(String.prototype, "includes", {
        configurable: true,
        value: () => false,
        writable: true,
      });
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: () => true,
        writable: true,
      });
      Object.defineProperty(Number, "isSafeInteger", {
        configurable: true,
        value: () => false,
        writable: true,
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: function* poisonedIterator() {
          yield "OPENTRAD_PUBLIC_ORIGIN";
        },
        writable: true,
      });
      publicOrigin = loadConfig(validEnvironment()).publicOrigin;
      try {
        loadConfig(validEnvironment({ OPENTRAD_UNKNOWN_SETTING: "accepted-by-poison" }));
      } catch {
        rejectedUnknown = true;
      }
    } finally {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        value: originalStartsWith,
        writable: true,
      });
      Object.defineProperty(String.prototype, "trim", {
        configurable: true,
        value: originalTrim,
        writable: true,
      });
      Object.defineProperty(String.prototype, "includes", {
        configurable: true,
        value: originalIncludes,
        writable: true,
      });
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: originalSetHas,
        writable: true,
      });
      Object.defineProperty(Number, "isSafeInteger", {
        configurable: true,
        value: originalIsSafeInteger,
        writable: true,
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: originalIterator,
        writable: true,
      });
    }

    expect(publicOrigin).toBe("https://opentrad.example");
    expect(rejectedUnknown).toBe(true);
  });

  it("uses captured URL accessors for canonical origin checks", () => {
    const properties = ["protocol", "username", "password", "origin", "hostname"] as const;
    const descriptors = properties.map(
      (property) => [property, Reflect.getOwnPropertyDescriptor(URL.prototype, property)] as const,
    );
    let parsed = false;
    try {
      for (const property of properties) {
        Object.defineProperty(URL.prototype, property, {
          configurable: true,
          get() {
            throw new Error("poisoned URL getter");
          },
        });
      }
      parsed = loadConfig(validEnvironment()).publicOrigin === "https://opentrad.example";
    } finally {
      for (const [property, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(URL.prototype, property, descriptor);
      }
    }
    expect(parsed).toBe(true);
  });
});

describe("createAuthOptions", () => {
  it("accepts only the exact object returned by loadConfig", () => {
    const validated = loadConfig(validEnvironment());
    const forged = { ...validated };
    let getterCalls = 0;
    Object.defineProperty(forged, "publicOrigin", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "http://attacker.example";
      },
    });

    expect(() => createAuthOptions(forged)).toThrow("Invalid API configuration");
    expect(getterCalls).toBe(0);
  });

  it("derives Better Auth URL and database solely from the validated OpenTrad config", () => {
    const options = optionsForTest();

    expect(options.baseURL).toBe("https://opentrad.example");
    expect(options.trustedOrigins).toEqual(["https://opentrad.example"]);
    expect(options.secret).toBe("a".repeat(48));
    expect(options.database).toBeDefined();
  });

  it("uses seven-day sessions and the exact password policy", () => {
    const options = optionsForTest();

    expect(options.session).toEqual({ expiresIn: 604_800, updateAge: 86_400 });
    expect(options.emailAndPassword).toEqual({
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
    });
    expect(options.user).toEqual({ deleteUser: { enabled: true } });
  });

  it("enables secure cookies without disabling CSRF or origin protection", () => {
    const options = optionsForTest();

    expect(options.advanced).toEqual({
      cookiePrefix: "opentrad",
      database: { generateId: "uuid" },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: true,
    });
  });

  it("generates UUID database identifiers for the exact registration response contract", () => {
    const options = optionsForTest();

    expect(options.advanced).toMatchObject({ database: { generateId: "uuid" } });
  });

  it("uses non-secure cookies only for explicitly validated loopback HTTP", () => {
    const options = createAuthOptions(
      loadConfig(
        validEnvironment({
          NODE_ENV: "development",
          OPENTRAD_PUBLIC_ORIGIN: "http://localhost:5173",
        }),
      ),
    );
    const database = options.database;
    if (typeof database === "object" && database !== null && "close" in database) {
      DATABASES.push(database as { close(): void });
    }

    expect(options.advanced?.useSecureCookies).toBe(false);
  });

  it("keeps HTTPS cookies secure when URL and String prototype access is poisoned later", () => {
    const config = loadConfig(validEnvironment());
    const originalStartsWith = String.prototype.startsWith;
    const protocolDescriptor = Reflect.getOwnPropertyDescriptor(URL.prototype, "protocol");
    let secure: boolean | undefined;
    try {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        value: () => false,
        writable: true,
      });
      Object.defineProperty(URL.prototype, "protocol", {
        configurable: true,
        get() {
          return "http:";
        },
      });
      const options = createAuthOptions(config);
      const database = options.database;
      if (typeof database === "object" && database !== null && "close" in database) {
        DATABASES.push(database as { close(): void });
      }
      secure = options.advanced?.useSecureCookies;
    } finally {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        value: originalStartsWith,
        writable: true,
      });
      if (protocolDescriptor) {
        Object.defineProperty(URL.prototype, "protocol", protocolDescriptor);
      }
    }
    expect(secure).toBe(true);
  });

  it("uses the exact explicit account-linking policy", () => {
    const options = optionsForTest();

    expect(options.account).toEqual({
      accountLinking: {
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        enabled: true,
        updateUserInfoOnLink: false,
      },
      encryptOAuthTokens: true,
    });
  });

  it("reads GitHub credentials from config and requests user:email", () => {
    const options = optionsForTest();

    expect(options.socialProviders).toEqual({
      github: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
        scope: ["user:email"],
      },
    });
  });

  it("does not expose the GitHub provider when both credentials are absent", () => {
    const environment = validEnvironment();
    delete environment.GITHUB_CLIENT_ID;
    delete environment.GITHUB_CLIENT_SECRET;
    const options = createAuthOptions(loadConfig(environment));
    const database = options.database;
    if (typeof database === "object" && database !== null && "close" in database) {
      DATABASES.push(database as { close(): void });
    }

    expect(options.socialProviders).toBeUndefined();
  });

  it("makes usernames immutable, omits display usernames and blocks enumeration", () => {
    const options = optionsForTest();
    const usernamePlugin = options.plugins?.[0] as {
      id: string;
      options?: { displayUsername?: boolean; immutableUsername?: boolean };
    };

    expect(usernamePlugin.id).toBe("username");
    expect(usernamePlugin.options).toEqual({ displayUsername: false, immutableUsername: true });
    expect(options.disabledPaths).toContain("/is-username-available");
  });

  it("does not initialize email verification or password recovery", () => {
    const options = optionsForTest() as OpenTradAuthOptions & Record<string, unknown>;

    expect(options.emailVerification).toBeUndefined();
    expect(options.emailAndPassword).not.toHaveProperty("sendResetPassword");
    expect(options.disabledPaths).toEqual([
      "/is-username-available",
      "/request-password-reset",
      "/reset-password",
      "/sign-up/email",
      "/sign-up/username",
    ]);
    expect(options.logger).toEqual({ disabled: true });
  });

  it("createAuth opens exactly the unified configured database path", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "opentrad-auth-"));
    chmodSync(root, 0o700);
    const databasePath = join(root, "opentrad.sqlite");
    let database: { close(): void } | undefined;
    try {
      const auth = createAuth(
        loadConfig(validEnvironment({ OPENTRAD_DATABASE_PATH: databasePath })),
      );
      database = auth.options.database as { close(): void };
      expect(existsSync(databasePath)).toBe(true);
    } finally {
      database?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("privacy-safe registration primitives", () => {
  it("creates random opaque internal aliases under the reserved invalid domain", () => {
    const first = createInternalEmailAlias();
    const second = createInternalEmailAlias();

    expect(first).toMatch(/^[A-Za-z0-9_-]{24}@users\.opentrad\.invalid$/u);
    expect(second).toMatch(/^[A-Za-z0-9_-]{24}@users\.opentrad\.invalid$/u);
    expect(second).not.toBe(first);
    expect(first).not.toContain("trade_user");
    expect(first).not.toContain("correct-horse-battery-staple");
  });

  it("keeps aliases opaque when Buffer string conversion is poisoned", () => {
    const originalToString = Buffer.prototype.toString;
    let alias: string | undefined;
    try {
      Object.defineProperty(Buffer.prototype, "toString", {
        configurable: true,
        value: () => "trade_user\r\n@example.com",
        writable: true,
      });
      alias = createInternalEmailAlias();
    } finally {
      Object.defineProperty(Buffer.prototype, "toString", {
        configurable: true,
        value: originalToString,
        writable: true,
      });
    }

    expect(alias).toMatch(/^[A-Za-z0-9_-]{24}@users\.opentrad\.invalid$/u);
    expect(alias).not.toContain("trade_user");
  });

  it("keeps the registration contract username-only with explicit no-recovery consent", () => {
    const registration = RegisterRequestSchema.parse({
      acknowledgements: { noPasswordRecovery: true },
      password: "correct-horse-battery-staple",
      username: "trade_user",
    });

    expect(registration).not.toHaveProperty("email");
    expect(registration.acknowledgements.noPasswordRecovery).toBe(true);
  });
});
