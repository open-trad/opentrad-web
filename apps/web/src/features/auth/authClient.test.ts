import { afterEach, describe, expect, it, vi } from "vitest";

const betterAuth = vi.hoisted(() => ({
  signInUsername: vi.fn(async () => ({ data: {}, error: null })),
  signInSocial: vi.fn(async () => ({ data: {}, error: null })),
  signOut: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock("better-auth/client/plugins", () => ({
  usernameClient: vi.fn(() => ({ id: "username" })),
}));
vi.mock("better-auth/react", () => ({
  createAuthClient: vi.fn(() => ({
    useSession: vi.fn(() => ({ data: null, isPending: false, refetch: vi.fn() })),
    signIn: { username: betterAuth.signInUsername, social: betterAuth.signInSocial },
    signOut: betterAuth.signOut,
  })),
}));

import { accountClient } from "./authClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("same-origin account client", () => {
  it("loads exact provider availability and registers without an email field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ githubEnabled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            recoveryAvailable: false,
            user: { id: "00000000-0000-4000-8000-000000000001", username: "trade_user" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(accountClient.loadOptions(signal)).resolves.toEqual({ githubEnabled: true });
    await accountClient.register({
      acknowledgements: { noPasswordRecovery: true },
      password: "correct-horse-battery-staple",
      username: "trade_user",
    });

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/auth-options",
      { credentials: "same-origin", headers: { accept: "application/json" }, signal },
    ]);
    const registration = fetchMock.mock.calls[1];
    expect(registration?.[0]).toBe("/api/v1/register");
    expect(registration?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse((registration?.[1] as RequestInit).body as string)).toEqual({
      acknowledgements: { noPasswordRecovery: true },
      password: "correct-horse-battery-staple",
      username: "trade_user",
    });
    expect((registration?.[1] as RequestInit).body).not.toContain("email");
  });

  it("uses only the username plugin endpoints and a fixed same-origin GitHub callback", async () => {
    await accountClient.signInUsername({
      username: "trade_user",
      password: "correct-horse-battery-staple",
    });
    await accountClient.signInGithub();
    await accountClient.signOut();

    expect(betterAuth.signInUsername).toHaveBeenCalledWith({
      username: "trade_user",
      password: "correct-horse-battery-staple",
    });
    expect(betterAuth.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: `${window.location.origin}/convert`,
    });
    expect(betterAuth.signOut).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed responses and provider errors without leaking details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ githubEnabled: true, secret: "private-sentinel" }), {
            status: 200,
          }),
      ),
    );
    await expect(accountClient.loadOptions(new AbortController().signal)).rejects.toThrow(
      "ACCOUNT_OPERATION_FAILED",
    );

    betterAuth.signInUsername.mockResolvedValueOnce({
      data: null,
      error: { message: "private-provider-sentinel" },
    } as never);
    await expect(
      accountClient.signInUsername({ username: "trade_user", password: "invalid-password" }),
    ).rejects.toThrow("ACCOUNT_OPERATION_FAILED");
  });

  it("rejects hostile credential objects without invoking accessors", async () => {
    let getterCalls = 0;
    const credentials = { password: "correct-horse-battery-staple" } as Record<string, unknown>;
    Object.defineProperty(credentials, "username", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "trade_user";
      },
    });
    const registration = {
      acknowledgements: { noPasswordRecovery: true },
      password: "correct-horse-battery-staple",
    } as Record<string, unknown>;
    Object.defineProperty(registration, "username", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "trade_user";
      },
    });

    await expect(accountClient.signInUsername(credentials as never)).rejects.toThrow(
      "ACCOUNT_OPERATION_FAILED",
    );
    await expect(accountClient.register(registration as never)).rejects.toThrow(
      "ACCOUNT_OPERATION_FAILED",
    );
    expect(getterCalls).toBe(0);
  });
});
