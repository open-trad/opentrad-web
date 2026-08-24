import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAuthPath, requestPath } from "../security/originGuard.js";

const AUTH_BODY_LIMIT = 16 * 1_024;
const AUTH_RESPONSE_LIMIT = 1 * 1_024 * 1_024;
const RESPONSE_CONTENT_TYPE_LIMIT = 256;
const RESPONSE_HEADER_VALUE_LIMIT = 8_192;
const MIME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const IntrinsicURL = URL;
const intrinsicDecodeURIComponent = decodeURIComponent;
const intrinsicBufferConcat = Buffer.concat;
const intrinsicBufferFrom = Buffer.from;
const intrinsicBufferToString = Buffer.prototype.toString;
const intrinsicClearTimeout = clearTimeout;
const intrinsicJsonParse = JSON.parse;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicReflectApply = Reflect.apply;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetTimeout = setTimeout;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringEndsWith = String.prototype.endsWith;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicStringTrim = String.prototype.trim;
const intrinsicUrlOriginGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "origin",
)?.get;
const intrinsicUrlHashGet = intrinsicReflectGetOwnPropertyDescriptor(URL.prototype, "hash")?.get;
const intrinsicUrlPathnameGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "pathname",
)?.get;
const intrinsicUrlPasswordGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "password",
)?.get;
const intrinsicUrlSearchParamsGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "searchParams",
)?.get;
const intrinsicUrlUsernameGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "username",
)?.get;
const intrinsicSearchParamsGetAll = URLSearchParams.prototype.getAll;

const ALLOWED_AUTH_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "expires",
  "location",
  "pragma",
  "vary",
  "www-authenticate",
]);
const intrinsicSetHas = Set.prototype.has;

export interface AuthHandlerRuntime {
  readonly handler: (request: Request) => Promise<Response>;
}

export interface AuthRouteOptions {
  readonly githubClientId: string | null;
  readonly handlerTimeoutMs: number;
  readonly publicOrigin: string;
}

class AuthBridgeFailure extends Error {
  constructor() {
    super("AUTH_BRIDGE_FAILED");
  }
}

function bridgeFailure(): never {
  throw new AuthBridgeFailure();
}

function exactContentType(request: FastifyRequest): boolean {
  const value = request.headers["content-type"];
  return value === "application/json";
}

function isPublicSignupPath(request: FastifyRequest, publicOrigin: string): boolean {
  try {
    if (!intrinsicUrlOriginGet || !intrinsicUrlPathnameGet) bridgeFailure();
    const path = requestPath(request);
    const parsed = new IntrinsicURL(path, `${publicOrigin}/`);
    if (intrinsicReflectApply(intrinsicUrlOriginGet, parsed, []) !== publicOrigin) bridgeFailure();
    const pathname = intrinsicReflectApply(intrinsicUrlPathnameGet, parsed, []) as string;
    const segments = intrinsicReflectApply(intrinsicStringSplit, pathname, ["/"]) as string[];
    if (
      (segments.length !== 5 && !(segments.length === 6 && segments[5] === "")) ||
      segments[0] !== "" ||
      segments[1] !== "api" ||
      segments[2] !== "auth" ||
      segments[3] !== "sign-up"
    ) {
      return false;
    }
    const finalSegment = intrinsicDecodeURIComponent(segments[4] ?? "");
    return finalSegment === "email" || finalSegment === "username";
  } catch (error) {
    if (error instanceof AuthBridgeFailure) throw error;
    return bridgeFailure();
  }
}

function safeCookie(cookie: string, secureRequired: boolean): boolean {
  const lower = intrinsicReflectApply(intrinsicStringToLowerCase, cookie, []) as string;
  if (
    cookie.length === 0 ||
    cookie.length > 4_096 ||
    intrinsicReflectApply(intrinsicStringIncludes, lower, ["\r"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, lower, ["\n"])
  ) {
    return false;
  }
  const parts = intrinsicReflectApply(intrinsicStringSplit, lower, [";"]) as string[];
  if (parts.length < 2 || parts.length > 32) return false;
  let httpOnly = false;
  let pathRoot = false;
  let sameSite = false;
  let secure = false;
  for (let index = 1; index < parts.length; index += 1) {
    const part = intrinsicReflectApply(intrinsicStringTrim, parts[index], []) as string;
    if (part === "httponly") {
      if (httpOnly) return false;
      httpOnly = true;
    } else if (part === "secure") {
      if (secure) return false;
      secure = true;
    } else if (part === "path=/") {
      if (pathRoot) return false;
      pathRoot = true;
    } else if (part === "samesite=lax" || part === "samesite=strict") {
      if (sameSite) return false;
      sameSite = true;
    } else if (
      part === "domain" ||
      intrinsicReflectApply(intrinsicStringStartsWith, part, ["domain="]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, part, ["path="]) ||
      intrinsicReflectApply(intrinsicStringStartsWith, part, ["samesite="])
    ) {
      return false;
    }
  }
  return httpOnly && pathRoot && sameSite && (!secureRequired || secure);
}

function getSetCookies(headers: Headers): readonly string[] {
  try {
    const values = headers.getSetCookie();
    for (let index = 0; index < values.length; index += 1) {
      if (typeof values[index] !== "string") bridgeFailure();
    }
    return values;
  } catch {
    return bridgeFailure();
  }
}

interface AuthResponseHeaderSnapshot {
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookies: readonly string[];
}

function oneQueryValue(searchParams: URLSearchParams, name: string): string | null {
  const values = intrinsicReflectApply(intrinsicSearchParamsGetAll, searchParams, [
    name,
  ]) as string[];
  return values.length === 1 ? (values[0] ?? null) : null;
}

function safeGithubScopes(searchParams: URLSearchParams): boolean {
  const scope = oneQueryValue(searchParams, "scope");
  if (scope === null) return false;
  const scopes = intrinsicReflectApply(intrinsicStringSplit, scope, [" "]) as string[];
  if (scopes.length < 2 || scopes.length > 8) return false;
  let readUser = false;
  let userEmail = false;
  for (let index = 0; index < scopes.length; index += 1) {
    const value = scopes[index];
    if (value === "read:user") readUser = true;
    else if (value === "user:email") userEmail = true;
    else return false;
  }
  return readUser && userEmail;
}

function safeGithubAuthorizationLocation(
  target: URL,
  publicOrigin: string,
  githubClientId: string,
): boolean {
  try {
    if (
      !intrinsicUrlHashGet ||
      !intrinsicUrlOriginGet ||
      !intrinsicUrlPasswordGet ||
      !intrinsicUrlPathnameGet ||
      !intrinsicUrlSearchParamsGet ||
      !intrinsicUrlUsernameGet
    ) {
      return false;
    }
    if (
      intrinsicReflectApply(intrinsicUrlOriginGet, target, []) !== "https://github.com" ||
      intrinsicReflectApply(intrinsicUrlPathnameGet, target, []) !== "/login/oauth/authorize" ||
      intrinsicReflectApply(intrinsicUrlUsernameGet, target, []) !== "" ||
      intrinsicReflectApply(intrinsicUrlPasswordGet, target, []) !== "" ||
      intrinsicReflectApply(intrinsicUrlHashGet, target, []) !== ""
    ) {
      return false;
    }
    const searchParams = intrinsicReflectApply(
      intrinsicUrlSearchParamsGet,
      target,
      [],
    ) as URLSearchParams;
    const state = oneQueryValue(searchParams, "state");
    const challenge = oneQueryValue(searchParams, "code_challenge");
    return (
      oneQueryValue(searchParams, "response_type") === "code" &&
      oneQueryValue(searchParams, "client_id") === githubClientId &&
      oneQueryValue(searchParams, "redirect_uri") === `${publicOrigin}/api/auth/callback/github` &&
      oneQueryValue(searchParams, "code_challenge_method") === "S256" &&
      safeGithubScopes(searchParams) &&
      state !== null &&
      state.length > 0 &&
      state.length <= 1_024 &&
      challenge !== null &&
      challenge.length > 0 &&
      challenge.length <= 1_024
    );
  } catch {
    return false;
  }
}

function safeLocation(
  location: string,
  publicOrigin: string,
  githubAuthorizationClientId: string | null,
): boolean {
  try {
    if (!intrinsicUrlOriginGet) return false;
    if (intrinsicReflectApply(intrinsicStringStartsWith, location, ["//"])) return false;
    const target = new IntrinsicURL(location, publicOrigin);
    if (intrinsicReflectApply(intrinsicUrlOriginGet, target, []) === publicOrigin) return true;
    return (
      githubAuthorizationClientId !== null &&
      intrinsicReflectApply(intrinsicStringStartsWith, location, [
        "https://github.com/login/oauth/authorize?",
      ]) &&
      safeGithubAuthorizationLocation(target, publicOrigin, githubAuthorizationClientId)
    );
  } catch {
    return false;
  }
}

function snapshotAuthResponseHeaders(
  headers: Headers,
  publicOrigin: string,
  secureRequired: boolean,
  githubAuthorizationClientId: string | null,
): AuthResponseHeaderSnapshot {
  try {
    const setCookies = getSetCookies(headers);
    for (let index = 0; index < setCookies.length; index += 1) {
      const cookie = setCookies[index];
      if (cookie === undefined || !safeCookie(cookie, secureRequired)) bridgeFailure();
    }
    const allowed: Array<readonly [string, string]> = [];
    headers.forEach((value, name) => {
      const lowerName = intrinsicReflectApply(intrinsicStringToLowerCase, name, []) as string;
      if (
        value.length > RESPONSE_HEADER_VALUE_LIMIT ||
        intrinsicReflectApply(intrinsicStringIncludes, value, ["\0"]) ||
        intrinsicReflectApply(intrinsicStringIncludes, value, ["\r"]) ||
        intrinsicReflectApply(intrinsicStringIncludes, value, ["\n"])
      ) {
        bridgeFailure();
      }
      if (
        lowerName === "location" &&
        !safeLocation(value, publicOrigin, githubAuthorizationClientId)
      )
        bridgeFailure();
      if (intrinsicReflectApply(intrinsicSetHas, ALLOWED_AUTH_RESPONSE_HEADERS, [lowerName])) {
        allowed.push(Object.freeze([lowerName, value] as const));
      }
    });
    return Object.freeze({
      headers: Object.freeze(allowed),
      setCookies: Object.freeze([...setCookies]),
    });
  } catch {
    return bridgeFailure();
  }
}

export function applyAuthResponseHeaders(
  reply: FastifyReply,
  headers: Headers,
  publicOrigin: string,
  secureRequired: boolean,
  githubAuthorizationClientId: string | null = null,
): void {
  try {
    const snapshot = snapshotAuthResponseHeaders(
      headers,
      publicOrigin,
      secureRequired,
      githubAuthorizationClientId,
    );
    for (let index = 0; index < snapshot.headers.length; index += 1) {
      const header = snapshot.headers[index];
      if (header === undefined) bridgeFailure();
      reply.header(header[0], header[1]);
    }
    if (snapshot.setCookies.length > 0) reply.header("set-cookie", [...snapshot.setCookies]);
  } catch {
    bridgeFailure();
  }
}

async function boundedResponseBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  const body = response.body;
  if (body === null) return intrinsicBufferFrom("");
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > AUTH_RESPONSE_LIMIT) {
        await reader.cancel();
        bridgeFailure();
      }
      chunks.push(part.value);
    }
    return intrinsicReflectApply(intrinsicBufferConcat, Buffer, [chunks, total]) as Buffer;
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The fixed bridge error below is the only externally observable failure.
    }
    return bridgeFailure();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function stripInternalEmail(value: unknown, depth = 0): unknown {
  if (depth > 12) bridgeFailure();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      output.push(stripInternalEmail(value[index], depth + 1));
    }
    return output;
  }
  const output = Object.create(null) as Record<string, unknown>;
  const keys = intrinsicReflectOwnKeys(value);
  if (keys.length > 128) bridgeFailure();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") bridgeFailure();
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) bridgeFailure();
    if (key !== "email") output[key] = stripInternalEmail(descriptor.value, depth + 1);
  }
  return output;
}

function responseIsJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  if (contentType.length === 0 || contentType.length > RESPONSE_CONTENT_TYPE_LIMIT) bridgeFailure();
  const parts = intrinsicReflectApply(intrinsicStringSplit, contentType, [";"]) as string[];
  if (parts.length === 0 || parts.length > 8) bridgeFailure();
  const rawMediaType = intrinsicReflectApply(intrinsicStringTrim, parts[0] ?? "", []) as string;
  const mediaType = intrinsicReflectApply(intrinsicStringToLowerCase, rawMediaType, []) as string;
  const slashIndex = intrinsicReflectApply(intrinsicStringIndexOf, mediaType, ["/"]) as number;
  if (slashIndex <= 0 || slashIndex === mediaType.length - 1) bridgeFailure();
  if (
    (intrinsicReflectApply(intrinsicStringIndexOf, mediaType, ["/", slashIndex + 1]) as number) !==
    -1
  ) {
    bridgeFailure();
  }
  const type = intrinsicReflectApply(intrinsicStringSlice, mediaType, [0, slashIndex]) as string;
  const subtype = intrinsicReflectApply(intrinsicStringSlice, mediaType, [
    slashIndex + 1,
  ]) as string;
  if (
    !intrinsicReflectApply(intrinsicRegExpTest, MIME_TOKEN, [type]) ||
    !intrinsicReflectApply(intrinsicRegExpTest, MIME_TOKEN, [subtype])
  ) {
    bridgeFailure();
  }
  let charsetSeen = false;
  for (let index = 1; index < parts.length; index += 1) {
    const parameter = intrinsicReflectApply(intrinsicStringTrim, parts[index] ?? "", []) as string;
    const equalsIndex = intrinsicReflectApply(intrinsicStringIndexOf, parameter, ["="]) as number;
    if (equalsIndex <= 0 || equalsIndex === parameter.length - 1) bridgeFailure();
    const rawName = intrinsicReflectApply(intrinsicStringSlice, parameter, [
      0,
      equalsIndex,
    ]) as string;
    const name = intrinsicReflectApply(
      intrinsicStringToLowerCase,
      intrinsicReflectApply(intrinsicStringTrim, rawName, []),
      [],
    ) as string;
    if (name !== "charset" || charsetSeen) bridgeFailure();
    let value = intrinsicReflectApply(
      intrinsicStringTrim,
      intrinsicReflectApply(intrinsicStringSlice, parameter, [equalsIndex + 1]),
      [],
    ) as string;
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = intrinsicReflectApply(intrinsicStringSlice, value, [1, -1]) as string;
    }
    if (!intrinsicReflectApply(intrinsicRegExpTest, MIME_TOKEN, [value])) bridgeFailure();
    if ((intrinsicReflectApply(intrinsicStringToLowerCase, value, []) as string) !== "utf-8") {
      bridgeFailure();
    }
    charsetSeen = true;
  }
  return (
    type === "application" &&
    (subtype === "json" || intrinsicReflectApply(intrinsicStringEndsWith, subtype, ["+json"]))
  );
}

function privacySafeResponseBody(response: Response, body: Buffer): Buffer {
  if (body.length === 0) return body;
  const isJson = responseIsJson(response.headers.get("content-type"));
  if (!isJson) {
    const text = intrinsicReflectApply(intrinsicBufferToString, body, ["utf8"]) as string;
    if (intrinsicReflectApply(intrinsicStringIncludes, text, ["@users.opentrad.invalid"])) {
      bridgeFailure();
    }
    return body;
  }
  try {
    const text = intrinsicReflectApply(intrinsicBufferToString, body, ["utf8"]) as string;
    const parsed = intrinsicReflectApply(intrinsicJsonParse, JSON, [text]);
    const sanitized = stripInternalEmail(parsed);
    const serialized = intrinsicReflectApply(intrinsicJsonStringify, JSON, [sanitized]) as string;
    if (intrinsicReflectApply(intrinsicStringIncludes, serialized, ["@users.opentrad.invalid"])) {
      bridgeFailure();
    }
    return intrinsicBufferFrom(serialized, "utf8");
  } catch {
    return bridgeFailure();
  }
}

function validateGithubAuthorizationResponse(
  response: Response,
  body: Buffer,
  publicOrigin: string,
  githubClientId: string,
): void {
  try {
    if (!responseIsJson(response.headers.get("content-type"))) bridgeFailure();
    const parsed = intrinsicReflectApply(intrinsicJsonParse, JSON, [
      intrinsicReflectApply(intrinsicBufferToString, body, ["utf8"]),
    ]);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) bridgeFailure();
    const keys = intrinsicReflectOwnKeys(parsed);
    if (keys.length !== 2) bridgeFailure();
    let redirectKey = false;
    let urlKey = false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === "redirect") redirectKey = true;
      else if (key === "url") urlKey = true;
      else bridgeFailure();
    }
    if (!redirectKey || !urlKey) bridgeFailure();
    const redirect = intrinsicReflectGetOwnPropertyDescriptor(parsed, "redirect");
    const url = intrinsicReflectGetOwnPropertyDescriptor(parsed, "url");
    const location = response.headers.get("location");
    if (
      !redirect ||
      !("value" in redirect) ||
      redirect.value !== true ||
      !url ||
      !("value" in url) ||
      typeof url.value !== "string" ||
      location === null ||
      url.value !== location ||
      !safeGithubAuthorizationLocation(
        new IntrinsicURL(url.value, publicOrigin),
        publicOrigin,
        githubClientId,
      )
    ) {
      bridgeFailure();
    }
  } catch {
    bridgeFailure();
  }
}

function bridgeUrl(request: FastifyRequest, publicOrigin: string): string {
  const path = requestPath(request);
  if (!isAuthPath(path) || path.length > 2_048) bridgeFailure();
  const url = `${publicOrigin}${path}`;
  if (!intrinsicReflectApply(intrinsicStringStartsWith, url, [`${publicOrigin}/api/auth/`])) {
    bridgeFailure();
  }
  return url;
}

async function callHandlerWithLifecycle(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthHandlerRuntime,
  webRequest: Request,
  timeoutMs: number,
  controller: AbortController,
): Promise<{ readonly body: Buffer; readonly response: Response }> {
  let rejectLifecycle: ((error: Error) => void) | undefined;
  const lifecycle = new Promise<never>((_resolve, reject) => {
    rejectLifecycle = reject;
  });
  const abort = () => {
    try {
      controller.abort();
    } finally {
      rejectLifecycle?.(new AuthBridgeFailure());
    }
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", abort);
  const timeout = intrinsicSetTimeout(abort, timeoutMs);
  try {
    if (request.raw.aborted || reply.raw.destroyed) abort();
    const transaction = Promise.resolve(auth.handler(webRequest)).then(async (response) => {
      if (!(response instanceof Response) || response.status < 100 || response.status > 599) {
        bridgeFailure();
      }
      return {
        body: await boundedResponseBody(response, controller.signal),
        response,
      };
    });
    return await Promise.race([transaction, lifecycle]);
  } finally {
    intrinsicClearTimeout(timeout);
    request.raw.removeListener("aborted", abort);
    reply.raw.removeListener("close", abort);
    rejectLifecycle = undefined;
  }
}

export function mountAuthHandler(
  app: FastifyInstance,
  auth: AuthHandlerRuntime,
  options: AuthRouteOptions,
): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    bodyLimit: AUTH_BODY_LIMIT,
    config: {
      rateLimit: {
        groupId: "auth",
        max: 30,
        timeWindow: 60_000,
      },
    },
    async handler(request, reply) {
      try {
        if (isPublicSignupPath(request, options.publicOrigin)) {
          return reply
            .status(request.method === "POST" ? 404 : 405)
            .send({ error: { code: "INVALID_REQUEST" } });
        }
        const isGet = request.method === "GET";
        if (!isGet && !exactContentType(request)) {
          return reply.status(415).send({ error: { code: "INVALID_REQUEST" } });
        }
        if (!isGet && !Buffer.isBuffer(request.body)) {
          return reply.status(400).send({ error: { code: "INVALID_REQUEST" } });
        }
        const controller = new AbortController();
        const headers = fromNodeHeaders(request.headers);
        headers.delete("forwarded");
        headers.delete("x-forwarded-for");
        headers.delete("x-forwarded-host");
        headers.delete("x-forwarded-port");
        headers.delete("x-forwarded-proto");
        const webRequest = new Request(bridgeUrl(request, options.publicOrigin), {
          body: isGet ? undefined : new Uint8Array(request.body as Buffer),
          headers,
          method: request.method,
          signal: controller.signal,
        });
        const transaction = await callHandlerWithLifecycle(
          request,
          reply,
          auth,
          webRequest,
          options.handlerTimeoutMs,
          controller,
        );
        const response = transaction.response;
        const upstreamBody = transaction.body;
        const isAuthError = response.status >= 400;
        const body = isAuthError
          ? intrinsicBufferFrom('{"error":{"code":"INVALID_REQUEST"}}', "utf8")
          : privacySafeResponseBody(response, upstreamBody);
        const githubAuthorizationClientId =
          response.status === 200 &&
          request.method === "POST" &&
          requestPath(request) === "/api/auth/sign-in/social"
            ? options.githubClientId
            : null;
        if (githubAuthorizationClientId !== null) {
          validateGithubAuthorizationResponse(
            response,
            body,
            options.publicOrigin,
            githubAuthorizationClientId,
          );
        }
        applyAuthResponseHeaders(
          reply,
          response.headers,
          options.publicOrigin,
          intrinsicReflectApply(intrinsicStringStartsWith, options.publicOrigin, [
            "https://",
          ]) as boolean,
          githubAuthorizationClientId,
        );
        if (isAuthError) reply.header("content-type", "application/json");
        reply.status(isAuthError ? 400 : response.status);
        return reply.send(body);
      } catch {
        return reply.status(503).send({ error: { code: "INVALID_REQUEST", retryable: true } });
      }
    },
  });
}
