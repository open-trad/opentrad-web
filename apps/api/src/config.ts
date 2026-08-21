const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicNumber = Number;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetHas = Set.prototype.has;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringTrim = String.prototype.trim;
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
const validatedConfigurations = new IntrinsicWeakSet<object>();

const PORT_PATTERN =
  /^(?:[1-9]|[1-9]\d{1,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/u;
const REQUIRED_NAMES = [
  "NODE_ENV",
  "OPENTRAD_PUBLIC_ORIGIN",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
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
const ALLOWED_NAMES = new Set<string>(REQUIRED_NAMES);

export type ApiNodeEnvironment = "development" | "test" | "production";

export interface ApiConfig {
  readonly nodeEnv: ApiNodeEnvironment;
  readonly publicOrigin: string;
  readonly betterAuthSecret: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly databasePath: string;
  readonly jobRoot: string;
  readonly clamdHost: string;
  readonly clamdPort: number;
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
  if (prototype !== intrinsicObjectPrototype && prototype !== null) invalidConfiguration();
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
    defineConfigValue(output, "githubClientId", required(environment, "GITHUB_CLIENT_ID"));
    defineConfigValue(output, "githubClientSecret", required(environment, "GITHUB_CLIENT_SECRET"));
    defineConfigValue(output, "databasePath", required(environment, "OPENTRAD_DATABASE_PATH"));
    defineConfigValue(output, "jobRoot", required(environment, "OPENTRAD_JOB_ROOT"));
    defineConfigValue(output, "clamdHost", required(environment, "OPENTRAD_CLAMD_HOST"));
    defineConfigValue(output, "clamdPort", parsePort(required(environment, "OPENTRAD_CLAMD_PORT")));
    intrinsicReflectApply(intrinsicWeakSetAdd, validatedConfigurations, [output]);
    return intrinsicFreeze(output) as unknown as ApiConfig;
  } catch {
    return invalidConfiguration();
  }
}
