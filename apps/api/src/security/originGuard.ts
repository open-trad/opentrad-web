import type { FastifyRequest } from "fastify";

const IntrinsicURL = URL;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicUrlHostGet = intrinsicReflectGetOwnPropertyDescriptor(URL.prototype, "host")?.get;
const intrinsicUrlOriginGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "origin",
)?.get;
const intrinsicUrlPasswordGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "password",
)?.get;
const intrinsicUrlProtocolGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "protocol",
)?.get;
const intrinsicUrlUsernameGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "username",
)?.get;

export class RequestBoundaryError extends Error {
  readonly code: "ORIGIN_REJECTED";
  readonly statusCode: 403;

  constructor() {
    super("ORIGIN_REJECTED");
    this.code = "ORIGIN_REJECTED";
    this.statusCode = 403;
  }
}

function reject(): never {
  throw new RequestBoundaryError();
}

function ownHeader(request: FastifyRequest, name: string): string | undefined {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(request.headers, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || typeof descriptor.value !== "string") reject();
  const value = descriptor.value;
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\0"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\r"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\n"])
  ) {
    reject();
  }
  return value;
}

function publicAuthority(publicOrigin: string): string {
  try {
    if (!intrinsicUrlHostGet || !intrinsicUrlOriginGet) reject();
    const parsed = new IntrinsicURL(publicOrigin);
    if (intrinsicReflectApply(intrinsicUrlOriginGet, parsed, []) !== publicOrigin) reject();
    return intrinsicReflectApply(intrinsicUrlHostGet, parsed, []) as string;
  } catch {
    return reject();
  }
}

function publicProtocol(publicOrigin: string): string {
  try {
    if (!intrinsicUrlProtocolGet) reject();
    const parsed = new IntrinsicURL(publicOrigin);
    const protocol = intrinsicReflectApply(intrinsicUrlProtocolGet, parsed, []) as string;
    if (protocol !== "https:" && protocol !== "http:") reject();
    return protocol === "https:" ? "https" : "http";
  } catch {
    return reject();
  }
}

function isCanonicalOrigin(value: string): boolean {
  try {
    if (!intrinsicUrlOriginGet || !intrinsicUrlUsernameGet || !intrinsicUrlPasswordGet)
      return false;
    const parsed = new IntrinsicURL(value);
    return (
      intrinsicReflectApply(intrinsicUrlOriginGet, parsed, []) === value &&
      intrinsicReflectApply(intrinsicUrlUsernameGet, parsed, []) === "" &&
      intrinsicReflectApply(intrinsicUrlPasswordGet, parsed, []) === ""
    );
  } catch {
    return false;
  }
}

export function requestPath(request: FastifyRequest): string {
  const value = request.raw.url;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    !intrinsicReflectApply(intrinsicStringStartsWith, value, ["/"]) ||
    intrinsicReflectApply(intrinsicStringStartsWith, value, ["//"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["#"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\0"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\r"]) ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\n"])
  ) {
    reject();
  }
  return value;
}

export function requireTrustedHost(
  request: FastifyRequest,
  publicOrigin: string,
  isTrustedProxy: (address: string) => boolean = () => false,
): void {
  try {
    if (ownHeader(request, "host") !== publicAuthority(publicOrigin)) reject();
    const remoteAddress = request.raw.socket.remoteAddress;
    const trustedRemote =
      typeof remoteAddress === "string" &&
      remoteAddress.length > 0 &&
      isTrustedProxy(remoteAddress);
    if (!trustedRemote) return;
    const forwardedHost = ownHeader(request, "x-forwarded-host");
    const forwardedProtocol = ownHeader(request, "x-forwarded-proto");
    if (
      ownHeader(request, "forwarded") !== undefined ||
      ownHeader(request, "x-forwarded-port") !== undefined ||
      (forwardedHost !== undefined && forwardedHost !== publicAuthority(publicOrigin)) ||
      (forwardedProtocol !== undefined && forwardedProtocol !== publicProtocol(publicOrigin))
    )
      reject();
  } catch {
    reject();
  }
}

export function requireSameOrigin(request: FastifyRequest, publicOrigin: string): void {
  try {
    const origin = ownHeader(request, "origin");
    const fetchSite = ownHeader(request, "sec-fetch-site");
    if (
      origin === undefined ||
      fetchSite !== "same-origin" ||
      !isCanonicalOrigin(origin) ||
      origin !== publicOrigin
    ) {
      reject();
    }
  } catch {
    reject();
  }
}

export function isAuthPath(path: string): boolean {
  return intrinsicReflectApply(intrinsicStringStartsWith, path, ["/api/auth/"]) as boolean;
}
