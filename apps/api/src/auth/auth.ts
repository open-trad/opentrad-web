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
  const database = openDatabase(config.databasePath);
  const deleteOwnerData = database.transaction((ownerId: string) => {
    database.prepare("DELETE FROM idempotency WHERE owner_id = ?").run(ownerId);
    database.prepare("DELETE FROM jobs WHERE owner_id = ?").run(ownerId);
    database.prepare("DELETE FROM daily_usage WHERE owner_id = ?").run(ownerId);
  });
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
      database: { generateId: "uuid" },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: intrinsicReflectApply(intrinsicStringStartsWith, config.publicOrigin, [
        "https://",
      ]),
    },
    baseURL: config.publicOrigin,
    database,
    disabledPaths: [
      "/is-username-available",
      "/request-password-reset",
      "/reset-password",
      "/sign-up/email",
      "/sign-up/username",
    ],
    emailAndPassword: {
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
    },
    logger: { disabled: true },
    plugins: [username({ displayUsername: false, immutableUsername: true })],
    secret: config.betterAuthSecret,
    session: { expiresIn: 604_800, updateAge: 86_400 },
    trustedOrigins: [config.publicOrigin],
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          deleteOwnerData(user.id);
        },
      },
    },
  };
  if (config.githubClientId !== null && config.githubClientSecret !== null) {
    options.socialProviders = {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        scope: ["user:email"],
      },
    };
  }
  return options;
}

export function createAuth(config: AuthConfig) {
  return betterAuth(createAuthOptions(config));
}

export function createInternalEmailAlias(): string {
  const opaqueId = intrinsicReflectApply(intrinsicBufferToString, randomBytes(18), ["base64url"]);
  return `${opaqueId}@users.opentrad.invalid`;
}
