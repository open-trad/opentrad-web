import { BlockList } from "node:net";
import { pathToFileURL } from "node:url";
import rateLimit from "@fastify/rate-limit";
import fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import { createAuth } from "./auth/auth.js";
import { type AuthHandlerRuntime, mountAuthHandler } from "./auth/fastifyHandler.js";
import type { SessionAuthRuntime } from "./auth/sessionGuard.js";
import { type ApiConfig, assertApiConfig, canonicalizeIpAddress, loadConfig } from "./config.js";
import { type RegistrationAuthRuntime, registerRegistrationRoute } from "./routes/register.js";
import { createPrivacyLoggerOptions, type PrivacyLogStream } from "./security/logRedaction.js";
import {
  isAuthPath,
  RequestBoundaryError,
  requestPath,
  requireSameOrigin,
  requireTrustedHost,
} from "./security/originGuard.js";

const DEFAULT_AUTH_HANDLER_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BODY = 16 * 1_024;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicReflectApply = Reflect.apply;
const IntrinsicBlockList = BlockList;

export interface ServerAuthRuntime extends AuthHandlerRuntime {
  readonly api: RegistrationAuthRuntime["api"] & SessionAuthRuntime["api"];
  readonly options?: {
    readonly database?: { close(): void };
  };
}

export interface ServerDependencies {
  readonly auth?: ServerAuthRuntime;
  readonly authHandlerTimeoutMs?: number;
  readonly logStream?: PrivacyLogStream;
}

interface ValidatedDependencies {
  readonly auth?: ServerAuthRuntime;
  readonly authHandlerTimeoutMs: number;
  readonly logStream?: PrivacyLogStream;
}

class RateBoundaryError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("RATE_LIMITED");
    this.statusCode = statusCode;
  }
}

function invalidDependencies(): never {
  throw new Error("Invalid server dependencies");
}

function ownDependency(value: object, name: string): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) invalidDependencies();
  return descriptor.value;
}

function snapshotDependencies(value: ServerDependencies | undefined): ValidatedDependencies {
  if (value === undefined) return { authHandlerTimeoutMs: DEFAULT_AUTH_HANDLER_TIMEOUT_MS };
  try {
    if (value === null || typeof value !== "object") invalidDependencies();
    const prototype = intrinsicGetPrototypeOf(value);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) invalidDependencies();
    const keys = intrinsicReflectOwnKeys(value);
    if (keys.length > 3) invalidDependencies();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key !== "auth" && key !== "authHandlerTimeoutMs" && key !== "logStream") {
        invalidDependencies();
      }
    }
    const auth = ownDependency(value, "auth");
    if (auth !== undefined && (auth === null || typeof auth !== "object")) invalidDependencies();
    const timeout = ownDependency(value, "authHandlerTimeoutMs");
    if (
      timeout !== undefined &&
      (typeof timeout !== "number" ||
        !intrinsicNumberIsSafeInteger(timeout) ||
        timeout < 10 ||
        timeout > 30_000)
    ) {
      invalidDependencies();
    }
    const logStream = ownDependency(value, "logStream");
    if (logStream !== undefined) {
      if (logStream === null || typeof logStream !== "object") invalidDependencies();
      const write = intrinsicReflectGetOwnPropertyDescriptor(logStream, "write");
      if (!write || !("value" in write) || typeof write.value !== "function") {
        invalidDependencies();
      }
    }
    return {
      auth: auth as ServerAuthRuntime | undefined,
      authHandlerTimeoutMs: (timeout as number | undefined) ?? DEFAULT_AUTH_HANDLER_TIMEOUT_MS,
      logStream: logStream as PrivacyLogStream | undefined,
    };
  } catch {
    return invalidDependencies();
  }
}

function stateChanging(request: FastifyRequest): boolean {
  switch (request.method) {
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "OPTIONS":
      return true;
    default:
      return false;
  }
}

function routePath(request: FastifyRequest): string {
  const raw = requestPath(request);
  const queryIndex = intrinsicReflectApply(intrinsicStringIndexOf, raw, ["?"]) as number;
  return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
}

function knownPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/v1/register" ||
    (intrinsicReflectApply(intrinsicStringStartsWith, path, ["/api/auth/"]) as boolean)
  );
}

function ownStatusCode(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(error, "statusCode");
  return descriptor && "value" in descriptor && typeof descriptor.value === "number"
    ? descriptor.value
    : undefined;
}

type TrustedProxyMatcher = (address: string) => boolean;

function createTrustedProxyMatcher(cidr: string | null): TrustedProxyMatcher {
  if (cidr === null) return () => false;
  try {
    const slashIndex = intrinsicReflectApply(intrinsicStringIndexOf, cidr, ["/"]) as number;
    const address =
      slashIndex === -1
        ? cidr
        : (intrinsicReflectApply(intrinsicStringSlice, cidr, [0, slashIndex]) as string);
    const canonical = canonicalizeIpAddress(address);
    if (!canonical) invalidDependencies();
    const type = canonical.family === 4 ? "ipv4" : "ipv6";
    const block = new IntrinsicBlockList();
    if (slashIndex === -1) {
      block.addAddress(canonical.address, type);
    } else {
      const prefixText = intrinsicReflectApply(intrinsicStringSlice, cidr, [
        slashIndex + 1,
      ]) as string;
      const prefix = Number(prefixText);
      block.addSubnet(canonical.address, prefix, type);
    }
    return (candidate: string) => {
      try {
        const candidateAddress = canonicalizeIpAddress(candidate);
        return (
          candidateAddress !== null &&
          candidateAddress.family === canonical.family &&
          block.check(candidateAddress.address, type)
        );
      } catch {
        return false;
      }
    };
  } catch {
    return invalidDependencies();
  }
}

function privateOrInvalidClientAddress(address: string): boolean {
  const canonical = canonicalizeIpAddress(address);
  if (!canonical) return true;
  if (canonical.family === 4) {
    const firstSeparator = intrinsicReflectApply(intrinsicStringIndexOf, canonical.address, [
      ".",
    ]) as number;
    const secondSeparator = intrinsicReflectApply(intrinsicStringIndexOf, canonical.address, [
      ".",
      firstSeparator + 1,
    ]) as number;
    const first = Number(
      intrinsicReflectApply(intrinsicStringSlice, canonical.address, [0, firstSeparator]),
    );
    const second = Number(
      intrinsicReflectApply(intrinsicStringSlice, canonical.address, [
        firstSeparator + 1,
        secondSeparator,
      ]),
    );
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (canonical.family === 6) {
    const lower = canonical.address;
    return (
      lower === "::" ||
      lower === "::1" ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["fc"]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["fd"]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["fe8"]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["fe9"]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["fea"]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, lower, ["feb"])
    );
  }
  return true;
}

function rateLimitKey(request: FastifyRequest, isTrustedProxy: TrustedProxyMatcher): string {
  const remoteAddress = request.raw.socket.remoteAddress;
  if (typeof remoteAddress !== "string" || remoteAddress.length === 0) return "direct:unknown";
  const canonicalRemote = canonicalizeIpAddress(remoteAddress);
  if (!canonicalRemote) return "direct:unknown";
  if (!isTrustedProxy(remoteAddress)) return `direct:${canonicalRemote.address}`;
  const clientAddress = request.ip;
  const canonicalClient = canonicalizeIpAddress(clientAddress);
  return privateOrInvalidClientAddress(clientAddress)
    ? `proxy:${canonicalRemote.address}`
    : `client:${canonicalClient?.address ?? canonicalRemote.address}`;
}

export function listenHostForConfig(config: ApiConfig): "0.0.0.0" | "127.0.0.1" {
  assertApiConfig(config);
  return config.nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1";
}

export async function buildServer(
  config: ApiConfig,
  dependencyInput?: ServerDependencies,
): Promise<FastifyInstance> {
  assertApiConfig(config);
  const dependencies = snapshotDependencies(dependencyInput);
  const isTrustedProxy = createTrustedProxyMatcher(config.trustedProxyCidr);
  const logger =
    dependencies.logStream || config.nodeEnv === "production"
      ? createPrivacyLoggerOptions(dependencies.logStream)
      : false;
  const serverOptions: FastifyServerOptions = {
    bodyLimit: MAX_REQUEST_BODY,
    exposeHeadRoutes: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger,
    trustProxy: config.trustedProxyCidr === null ? false : isTrustedProxy,
  };
  const app = fastify(serverOptions);

  const ownsAuth = dependencies.auth === undefined;
  const auth = dependencies.auth ?? (createAuth(config) as unknown as ServerAuthRuntime);
  const ownedDatabase = ownsAuth ? auth.options?.database : undefined;

  try {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      "application/json",
      { bodyLimit: MAX_REQUEST_BODY, parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    await app.register(rateLimit, {
      addHeaders: {
        "retry-after": true,
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
      },
      errorResponseBuilder: (_request, context) => new RateBoundaryError(context.statusCode),
      global: false,
      hook: "preHandler",
      keyGenerator: (request) => rateLimitKey(request, isTrustedProxy),
    });

    app.addHook("onRequest", async (request) => {
      requireTrustedHost(request, config.publicOrigin, isTrustedProxy);
      requestPath(request);
      if (stateChanging(request)) requireSameOrigin(request, config.publicOrigin);
    });

    app.addHook("onResponse", async (request, reply) => {
      app.log.info(
        { event: "request_complete", method: request.method, statusCode: reply.statusCode },
        "request_complete",
      );
    });

    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof RequestBoundaryError) {
        return reply.status(403).send({ error: { code: "ORIGIN_REJECTED" } });
      }
      if (error instanceof RateBoundaryError) {
        return reply
          .status(error.statusCode)
          .send({ error: { code: "INVALID_REQUEST", retryable: true } });
      }
      const statusCode = ownStatusCode(error);
      if (statusCode === 413 || statusCode === 415) {
        return reply.status(statusCode).send({ error: { code: "INVALID_REQUEST" } });
      }
      app.log.info({ code: "REQUEST_FAILED", event: "request_failed" }, "request_failed");
      return reply.status(500).send({ error: { code: "INVALID_REQUEST" } });
    });

    app.head("/api/health", async (_request, reply) => reply.status(200).send());
    app.get("/api/health", async () => ({ status: "ok" }));
    app.options("/api/v1/register", async (_request, reply) => reply.status(204).send());
    app.options("/api/auth/*", async (_request, reply) => reply.status(204).send());

    registerRegistrationRoute(app, auth, config.publicOrigin);
    mountAuthHandler(app, auth, {
      handlerTimeoutMs: dependencies.authHandlerTimeoutMs,
      publicOrigin: config.publicOrigin,
    });

    app.setNotFoundHandler((request, reply) => {
      const statusCode = knownPath(routePath(request)) ? 405 : 404;
      if (request.method === "HEAD") return reply.status(statusCode).send();
      return reply.status(statusCode).send({ error: { code: "INVALID_REQUEST" } });
    });

    if (ownedDatabase) {
      app.addHook("onClose", async () => {
        ownedDatabase.close();
      });
    }

    await app.ready();
    return app;
  } catch (error) {
    try {
      await app.close();
    } catch {
      if (ownedDatabase) ownedDatabase.close();
    }
    throw error;
  }
}

async function start(): Promise<void> {
  try {
    const config = loadConfig(process.env);
    const app = await buildServer(config);
    await app.listen({ host: listenHostForConfig(config), port: 3_000 });
  } catch {
    process.stderr.write("API_START_FAILED\n");
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (typeof entry === "string" && import.meta.url === pathToFileURL(entry).href) {
  await start();
}

export { isAuthPath };
