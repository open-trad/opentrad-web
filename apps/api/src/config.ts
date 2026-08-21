import { isIP, SocketAddress } from "node:net";

const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicNumber = Number;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicProcessEnvironment = process.env;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetHas = Set.prototype.has;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringTrim = String.prototype.trim;
const IntrinsicSocketAddress = SocketAddress;
const intrinsicSocketAddressGet = intrinsicReflectGetOwnPropertyDescriptor(
  SocketAddress.prototype,
  "address",
)?.get;
const intrinsicSocketAddressParse = SocketAddress.parse;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicURL = URL;
const intrinsicUrlHostnameGet = intrinsicReflectGetOwnPropertyDescriptor(
  URL.prototype,
  "hostname",
)?.get;
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
const IntrinsicWeakSet = WeakSet;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicIsIp = isIP;
const validatedConfigurations = new IntrinsicWeakSet<object>();

const PORT_PATTERN =
  /^(?:[1-9]|[1-9]\d{1,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/u;
const PROXY_PREFIX_PATTERN = /^(?:0|[1-9]\d{0,2})$/u;
const REQUIRED_NAMES = [
  "NODE_ENV",
  "OPENTRAD_PUBLIC_ORIGIN",
  "BETTER_AUTH_SECRET",
  "OPENTRAD_DATABASE_PATH",
  "OPENTRAD_JOB_ROOT",
  "OPENTRAD_CLAMD_HOST",
  "OPENTRAD_CLAMD_PORT",
] as const;
const FORBIDDEN_LEGACY_NAMES = new Set([
  "AUTH_DATABASE_PATH",
  "AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CLAMD_HOST",
  "CLAMD_PORT",
  "JOB_DATABASE_PATH",
  "JOB_ROOT",
  "NEXT_PUBLIC_BETTER_AUTH_URL",
]);
const ALLOWED_NAMES = new Set<string>([
  ...REQUIRED_NAMES,
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "OPENTRAD_TRUSTED_PROXY_CIDR",
]);

export type ApiNodeEnvironment = "development" | "test" | "production";

export interface ApiConfig {
  readonly nodeEnv: ApiNodeEnvironment;
  readonly publicOrigin: string;
  readonly betterAuthSecret: string;
  readonly githubClientId: string | null;
  readonly githubClientSecret: string | null;
  readonly databasePath: string;
  readonly jobRoot: string;
  readonly clamdHost: string;
  readonly clamdPort: number;
  readonly trustedProxyCidr: string | null;
}

export interface CanonicalIpAddress {
  readonly address: string;
  readonly family: 4 | 6;
  readonly mapped: boolean;
}

function invalidConfiguration(): never {
  throw new Error("Invalid API configuration");
}

export function assertApiConfig(value: unknown): asserts value is ApiConfig {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      !intrinsicReflectApply(intrinsicWeakSetHas, validatedConfigurations, [value])
    ) {
      invalidConfiguration();
    }
  } catch {
    invalidConfiguration();
  }
}

function isApplicationName(name: string): boolean {
  return (
    name === "NODE_ENV" ||
    name === "GITHUB_CLIENT_ID" ||
    name === "GITHUB_CLIENT_SECRET" ||
    intrinsicReflectApply(intrinsicStringStartsWith, name, ["GITHUB_CLIENT_"]) ||
    intrinsicReflectApply(intrinsicStringStartsWith, name, ["OPENTRAD_"]) ||
    intrinsicReflectApply(intrinsicStringStartsWith, name, ["BETTER_AUTH_"]) ||
    intrinsicReflectApply(intrinsicSetHas, FORBIDDEN_LEGACY_NAMES, [name])
  );
}

function snapshotEnvironment(input: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  if (input === null || typeof input !== "object") invalidConfiguration();
  const prototype = intrinsicGetPrototypeOf(input);
  if (
    input !== intrinsicProcessEnvironment &&
    prototype !== intrinsicObjectPrototype &&
    prototype !== null
  ) {
    invalidConfiguration();
  }
  const keys = intrinsicReflectOwnKeys(input);
  if (keys.length > 1_024) invalidConfiguration();

  const output = intrinsicObjectCreate(null) as Record<string, string>;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") invalidConfiguration();
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) invalidConfiguration();
    if (!isApplicationName(key)) continue;
    if (!intrinsicReflectApply(intrinsicSetHas, ALLOWED_NAMES, [key])) invalidConfiguration();
    if (typeof descriptor.value !== "string") invalidConfiguration();
    intrinsicDefineProperty(output, key, {
      enumerable: true,
      value: descriptor.value,
    });
  }
  return intrinsicFreeze(output);
}

function required(environment: Readonly<Record<string, string>>, name: string): string {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(environment, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
    return invalidConfiguration();
  }
  const value = descriptor.value;
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    intrinsicReflectApply(intrinsicStringTrim, value, []) !== value ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\0"])
  ) {
    return invalidConfiguration();
  }
  return value;
}

function optional(environment: Readonly<Record<string, string>>, name: string): string | undefined {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(environment, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || typeof descriptor.value !== "string") {
    return invalidConfiguration();
  }
  const value = descriptor.value;
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    intrinsicReflectApply(intrinsicStringTrim, value, []) !== value ||
    intrinsicReflectApply(intrinsicStringIncludes, value, ["\0"])
  ) {
    return invalidConfiguration();
  }
  return value;
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new IntrinsicURL(value);
  } catch {
    return invalidConfiguration();
  }
  if (
    !intrinsicUrlProtocolGet ||
    !intrinsicUrlUsernameGet ||
    !intrinsicUrlPasswordGet ||
    !intrinsicUrlOriginGet
  ) {
    return invalidConfiguration();
  }
  const protocol = intrinsicReflectApply(intrinsicUrlProtocolGet, url, []);
  if (
    (protocol !== "https:" && protocol !== "http:") ||
    intrinsicReflectApply(intrinsicUrlUsernameGet, url, []) !== "" ||
    intrinsicReflectApply(intrinsicUrlPasswordGet, url, []) !== "" ||
    intrinsicReflectApply(intrinsicUrlOriginGet, url, []) !== value
  ) {
    return invalidConfiguration();
  }
  return value;
}

function validateOriginForEnvironment(value: string, nodeEnvironment: ApiNodeEnvironment): string {
  const url = new IntrinsicURL(value);
  if (!intrinsicUrlProtocolGet || !intrinsicUrlHostnameGet) return invalidConfiguration();
  if (intrinsicReflectApply(intrinsicUrlProtocolGet, url, []) === "https:") return value;
  const hostname = intrinsicReflectApply(intrinsicUrlHostnameGet, url, []);
  if (
    nodeEnvironment === "production" ||
    (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]")
  ) {
    return invalidConfiguration();
  }
  return value;
}

function parseNodeEnvironment(value: string): ApiNodeEnvironment {
  if (value !== "development" && value !== "test" && value !== "production") {
    return invalidConfiguration();
  }
  return value;
}

function parsePort(value: string): number {
  if (!intrinsicReflectApply(intrinsicRegExpTest, PORT_PATTERN, [value])) invalidConfiguration();
  const port = intrinsicNumber(value);
  if (!intrinsicNumberIsSafeInteger(port) || port < 1 || port > 65_535) invalidConfiguration();
  return port;
}

export function canonicalizeIpAddress(value: string): CanonicalIpAddress | null {
  try {
    const sourceFamily = intrinsicIsIp(value);
    if (sourceFamily !== 4 && sourceFamily !== 6) return null;
    if (!intrinsicSocketAddressGet) return null;
    const parseInput = sourceFamily === 4 ? value : `[${value}]`;
    const parsed = intrinsicReflectApply(intrinsicSocketAddressParse, IntrinsicSocketAddress, [
      parseInput,
    ]);
    if (!parsed) return null;
    const address = intrinsicReflectApply(intrinsicSocketAddressGet, parsed, []);
    if (typeof address !== "string") return null;
    if (sourceFamily === 6) {
      const mappedPrefix = "::ffff:";
      if (intrinsicReflectApply(intrinsicStringStartsWith, address, [mappedPrefix])) {
        const mappedAddress = intrinsicReflectApply(intrinsicStringSlice, address, [
          mappedPrefix.length,
        ]) as string;
        if (intrinsicIsIp(mappedAddress) !== 4) return null;
        return intrinsicFreeze({ address: mappedAddress, family: 4, mapped: true });
      }
    }
    return intrinsicFreeze({ address, family: sourceFamily, mapped: false });
  } catch {
    return null;
  }
}

function ipAddressBytes(value: CanonicalIpAddress): Uint8Array | null {
  try {
    const output = new IntrinsicUint8Array(value.family === 4 ? 4 : 16);
    if (value.family === 4) {
      const octets = intrinsicReflectApply(intrinsicStringSplit, value.address, ["."]) as string[];
      if (octets.length !== 4) return null;
      for (let index = 0; index < 4; index += 1) {
        const octet = intrinsicNumber(octets[index]);
        if (!intrinsicNumberIsSafeInteger(octet) || octet < 0 || octet > 255) return null;
        output[index] = octet;
      }
      return output;
    }

    const compressionIndex = intrinsicReflectApply(intrinsicStringIndexOf, value.address, [
      "::",
    ]) as number;
    const leftText =
      compressionIndex === -1
        ? value.address
        : (intrinsicReflectApply(intrinsicStringSlice, value.address, [
            0,
            compressionIndex,
          ]) as string);
    const rightText =
      compressionIndex === -1
        ? ""
        : (intrinsicReflectApply(intrinsicStringSlice, value.address, [
            compressionIndex + 2,
          ]) as string);
    const left =
      leftText === ""
        ? []
        : (intrinsicReflectApply(intrinsicStringSplit, leftText, [":"]) as string[]);
    const right =
      rightText === ""
        ? []
        : (intrinsicReflectApply(intrinsicStringSplit, rightText, [":"]) as string[]);
    if (
      (compressionIndex === -1 && left.length !== 8) ||
      (compressionIndex !== -1 && left.length + right.length >= 8)
    ) {
      return null;
    }
    const missing = compressionIndex === -1 ? 0 : 8 - left.length - right.length;
    for (let groupIndex = 0; groupIndex < 8; groupIndex += 1) {
      let groupText: string;
      if (groupIndex < left.length) {
        groupText = left[groupIndex] as string;
      } else if (groupIndex < left.length + missing) {
        groupText = "0";
      } else {
        groupText = right[groupIndex - left.length - missing] as string;
      }
      const group = intrinsicNumber(`0x${groupText}`);
      if (!intrinsicNumberIsSafeInteger(group) || group < 0 || group > 0xffff) return null;
      output[groupIndex * 2] = group >> 8;
      output[groupIndex * 2 + 1] = group & 0xff;
    }
    return output;
  } catch {
    return null;
  }
}

function addressIsZero(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function hasNetworkHostBits(bytes: Uint8Array, prefix: number): boolean {
  for (let bit = prefix; bit < bytes.length * 8; bit += 1) {
    if (((bytes[bit >> 3] as number) & (1 << (7 - (bit & 7)))) !== 0) return true;
  }
  return false;
}

function parseTrustedProxy(value: string | undefined, nodeEnvironment: ApiNodeEnvironment) {
  if (value === undefined) {
    if (nodeEnvironment === "production") invalidConfiguration();
    return null;
  }
  const slashIndex = intrinsicReflectApply(intrinsicStringIndexOf, value, ["/"]) as number;
  const address =
    slashIndex === -1
      ? value
      : (intrinsicReflectApply(intrinsicStringSlice, value, [0, slashIndex]) as string);
  const canonical = canonicalizeIpAddress(address);
  if (!canonical || canonical.mapped) invalidConfiguration();
  const bytes = ipAddressBytes(canonical);
  if (!bytes || addressIsZero(bytes)) invalidConfiguration();
  if (slashIndex !== -1) {
    if (
      (intrinsicReflectApply(intrinsicStringIndexOf, value, ["/", slashIndex + 1]) as number) !== -1
    ) {
      invalidConfiguration();
    }
    const prefixText = intrinsicReflectApply(intrinsicStringSlice, value, [
      slashIndex + 1,
    ]) as string;
    if (!intrinsicReflectApply(intrinsicRegExpTest, PROXY_PREFIX_PATTERN, [prefixText])) {
      invalidConfiguration();
    }
    const prefix = intrinsicNumber(prefixText);
    const minimum = canonical.family === 4 ? 24 : 64;
    const maximum = canonical.family === 4 ? 32 : 128;
    if (
      !intrinsicNumberIsSafeInteger(prefix) ||
      prefix < minimum ||
      prefix > maximum ||
      address !== canonical.address ||
      hasNetworkHostBits(bytes, prefix)
    ) {
      invalidConfiguration();
    }
    return `${canonical.address}/${prefix}`;
  }
  return canonical.address;
}

function defineConfigValue<Key extends keyof ApiConfig>(
  output: Record<PropertyKey, unknown>,
  key: Key,
  value: ApiConfig[Key],
): void {
  intrinsicDefineProperty(output, key, { enumerable: true, value });
}

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  try {
    const environment = snapshotEnvironment(env);
    const output = intrinsicObjectCreate(null) as Record<PropertyKey, unknown>;
    const nodeEnvironment = parseNodeEnvironment(required(environment, "NODE_ENV"));
    defineConfigValue(output, "nodeEnv", nodeEnvironment);
    defineConfigValue(
      output,
      "publicOrigin",
      validateOriginForEnvironment(
        parseOrigin(required(environment, "OPENTRAD_PUBLIC_ORIGIN")),
        nodeEnvironment,
      ),
    );
    const secret = required(environment, "BETTER_AUTH_SECRET");
    if (secret.length < 32) invalidConfiguration();
    defineConfigValue(output, "betterAuthSecret", secret);
    const githubClientId = optional(environment, "GITHUB_CLIENT_ID");
    const githubClientSecret = optional(environment, "GITHUB_CLIENT_SECRET");
    if ((githubClientId === undefined) !== (githubClientSecret === undefined)) {
      invalidConfiguration();
    }
    defineConfigValue(output, "githubClientId", githubClientId ?? null);
    defineConfigValue(output, "githubClientSecret", githubClientSecret ?? null);
    defineConfigValue(output, "databasePath", required(environment, "OPENTRAD_DATABASE_PATH"));
    defineConfigValue(output, "jobRoot", required(environment, "OPENTRAD_JOB_ROOT"));
    defineConfigValue(output, "clamdHost", required(environment, "OPENTRAD_CLAMD_HOST"));
    defineConfigValue(output, "clamdPort", parsePort(required(environment, "OPENTRAD_CLAMD_PORT")));
    defineConfigValue(
      output,
      "trustedProxyCidr",
      parseTrustedProxy(optional(environment, "OPENTRAD_TRUSTED_PROXY_CIDR"), nodeEnvironment),
    );
    intrinsicReflectApply(intrinsicWeakSetAdd, validatedConfigurations, [output]);
    return intrinsicFreeze(output) as unknown as ApiConfig;
  } catch {
    return invalidConfiguration();
  }
}
