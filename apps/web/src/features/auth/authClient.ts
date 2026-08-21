import {
  AuthOptionsResponseSchema,
  type RegisterRequest,
  RegisterRequestSchema,
  RegistrationResponseSchema,
  UsernameSignInRequestSchema,
} from "@opentrad/contracts";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const betterAuthClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [usernameClient({ displayUsername: false })],
});

export interface AccountSessionState {
  readonly data: null | { readonly user: { readonly username?: string | null } };
  readonly isPending: boolean;
  readonly refetch: () => Promise<unknown>;
}

export interface AccountPanelClient {
  readonly useSession: () => AccountSessionState;
  readonly loadOptions: (signal: AbortSignal) => Promise<{ readonly githubEnabled: boolean }>;
  readonly register: (request: RegisterRequest) => Promise<void>;
  readonly signInUsername: (input: {
    readonly username: string;
    readonly password: string;
  }) => Promise<void>;
  readonly signInGithub: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

function authFailure(): Error {
  return new Error("ACCOUNT_OPERATION_FAILED");
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw authFailure();
  }
}

export const accountClient: AccountPanelClient = {
  useSession: betterAuthClient.useSession,
  async loadOptions(signal) {
    try {
      const response = await fetch("/api/v1/auth-options", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) throw authFailure();
      return AuthOptionsResponseSchema.parse(await responseJson(response));
    } catch {
      throw authFailure();
    }
  },
  async register(request) {
    try {
      const parsed = RegisterRequestSchema.parse(request);
      const response = await fetch("/api/v1/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!response.ok) throw authFailure();
      RegistrationResponseSchema.parse(await responseJson(response));
    } catch {
      throw authFailure();
    }
  },
  async signInUsername(input) {
    try {
      const result = await betterAuthClient.signIn.username(
        UsernameSignInRequestSchema.parse(input),
      );
      if (result.error) throw authFailure();
    } catch {
      throw authFailure();
    }
  },
  async signInGithub() {
    try {
      const result = await betterAuthClient.signIn.social({
        provider: "github",
        callbackURL: `${window.location.origin}/convert`,
      });
      if (result.error) throw authFailure();
    } catch {
      throw authFailure();
    }
  },
  async signOut() {
    try {
      const result = await betterAuthClient.signOut();
      if (result.error) throw authFailure();
    } catch {
      throw authFailure();
    }
  },
};
