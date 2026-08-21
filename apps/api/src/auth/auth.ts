import { randomBytes } from "node:crypto";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { type ApiConfig, assertApiConfig } from "../config.js";
import { openDatabase } from "../db/openDatabase.js";

const intrinsicReflectApply = Reflect.apply;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicBufferToString = Buffer.prototype.toString;

export type AuthConfig = ApiConfig;

export type OpenTradAuthOptions = BetterAuthOptions;

export function createAuthOptions(config: AuthConfig): OpenTradAuthOptions {
  assertApiConfig(config);
  const options: BetterAuthOptions = {
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        enabled: true,
        updateUserInfoOnLink: false,
      },
      encryptOAuthTokens: true,
    },
    advanced: {
      cookiePrefix: "opentrad",
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: intrinsicReflectApply(intrinsicStringStartsWith, config.publicOrigin, [
        "https://",
      ]),
    },
    baseURL: config.publicOrigin,
    database: openDatabase(config.databasePath),
    disabledPaths: ["/is-username-available", "/request-password-reset", "/reset-password"],
    emailAndPassword: {
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
    },
    plugins: [username({ displayUsername: false, immutableUsername: true })],
    secret: config.betterAuthSecret,
    session: { expiresIn: 604_800, updateAge: 86_400 },
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        scope: ["user:email"],
      },
    },
    trustedOrigins: [config.publicOrigin],
  };
  return options;
}

export function createAuth(config: AuthConfig) {
  return betterAuth(createAuthOptions(config));
}

export function createInternalEmailAlias(): string {
  const opaqueId = intrinsicReflectApply(intrinsicBufferToString, randomBytes(18), ["base64url"]);
  return `${opaqueId}@users.opentrad.invalid`;
}
