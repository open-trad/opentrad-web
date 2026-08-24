import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPanel, type AccountPanelClient } from "./AccountPanel";

function client(
  overrides: Partial<AccountPanelClient> = {},
): AccountPanelClient & Record<string, unknown> {
  return {
    useSession: () => ({ data: null, isPending: false, refetch: vi.fn(async () => undefined) }),
    loadOptions: vi.fn(async () => ({ githubEnabled: false })),
    register: vi.fn(async () => undefined),
    signInUsername: vi.fn(async () => undefined),
    signInGithub: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("conversion account panel", () => {
  it("logs in with a username and never asks for or renders an email", async () => {
    const user = userEvent.setup();
    const runtime = client();
    render(<AccountPanel client={runtime} />);

    await user.type(screen.getByLabelText("用户名"), "trade_user");
    await user.type(screen.getByLabelText("密码"), "correct-horse-battery-staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(runtime.signInUsername).toHaveBeenCalledWith({
      username: "trade_user",
      password: "correct-horse-battery-staple",
    });
    expect(screen.queryByLabelText(/邮箱/u)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/@users\.opentrad\.invalid/u);
  });

  it("requires the no-recovery acknowledgement before username registration", async () => {
    const user = userEvent.setup();
    const runtime = client();
    render(<AccountPanel client={runtime} />);

    await user.click(screen.getByRole("tab", { name: "注册" }));
    await user.type(screen.getByLabelText("注册用户名"), "new_trade_user");
    await user.type(screen.getByLabelText("注册密码"), "correct-horse-battery-staple");
    const submit = screen.getByRole("button", { name: "创建账户" });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "我已知晓该账户不提供密码找回" }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(runtime.register).toHaveBeenCalledWith({
      acknowledgements: { noPasswordRecovery: true },
      password: "correct-horse-battery-staple",
      username: "new_trade_user",
    });
  });

  it("shows GitHub only when the same-origin API reports it enabled", async () => {
    const enabled = client({ loadOptions: vi.fn(async () => ({ githubEnabled: true })) });
    const { unmount } = render(<AccountPanel client={enabled} />);
    const github = await screen.findByRole("button", { name: "使用 GitHub 登录" });
    const panel = github.closest("section");
    expect(panel?.querySelector("button")).toBe(github);
    expect(screen.getByText("或使用用户名")).toBeVisible();
    await userEvent.click(github);
    expect(enabled.signInGithub).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(github).toBeEnabled());
    unmount();

    const disabled = client();
    render(<AccountPanel client={disabled} />);
    await waitFor(() => expect(disabled.loadOptions).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "使用 GitHub 登录" })).not.toBeInTheDocument();
    expect(screen.queryByText("或使用用户名")).not.toBeInTheDocument();
  });

  it("connects explicit username, password, acknowledgement, and tab identifiers", async () => {
    const user = userEvent.setup();
    render(<AccountPanel client={client()} />);

    const username = screen.getByLabelText("用户名");
    const password = screen.getByLabelText("密码");
    expect(username).toHaveAttribute("name", "username");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(username).toHaveAttribute("minlength", "3");
    expect(username).toHaveAttribute("maxlength", "30");
    expect(screen.getByText("用户名", { selector: "label" })).toHaveAttribute("for", username.id);
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByText("密码", { selector: "label" })).toHaveAttribute("for", password.id);

    const loginTab = screen.getByRole("tab", { name: "登录" });
    const form = screen.getByRole("tabpanel");
    expect(loginTab).toHaveAttribute("aria-controls", form.id);
    expect(form).toHaveAttribute("aria-labelledby", loginTab.id);

    await user.click(screen.getByRole("tab", { name: "注册" }));
    const acknowledgement = screen.getByRole("checkbox", {
      name: "我已知晓该账户不提供密码找回",
    });
    expect(screen.getByText("我已知晓该账户不提供密码找回", { selector: "label" })).toHaveAttribute(
      "for",
      acknowledgement.id,
    );
  });

  it("exposes busy account operations, disables actions, and keeps the privacy footer exact", async () => {
    let resolveGithub: (() => void) | undefined;
    const runtime = client({
      loadOptions: vi.fn(async () => ({ githubEnabled: true })),
      signInGithub: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveGithub = resolve;
          }),
      ),
    });
    const user = userEvent.setup();
    render(<AccountPanel client={runtime} />);

    const github = await screen.findByRole("button", { name: "使用 GitHub 登录" });
    await user.click(github);
    const panel = github.closest("section");
    expect(panel).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "正在连接 GitHub…" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "登录" })).toBeDisabled();
    expect(screen.getByText("不收集邮箱 · 每次上传单独确认 · 任务结束自动清理")).toBeVisible();

    resolveGithub?.();
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  });

  it("keeps the GitHub label precise while a username login is busy", async () => {
    let resolveUsernameLogin: (() => void) | undefined;
    const runtime = client({
      loadOptions: vi.fn(async () => ({ githubEnabled: true })),
      signInUsername: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveUsernameLogin = resolve;
          }),
      ),
    });
    const user = userEvent.setup();
    render(<AccountPanel client={runtime} />);

    await screen.findByRole("button", { name: "使用 GitHub 登录" });
    await user.type(screen.getByLabelText("用户名"), "trade_user");
    await user.type(screen.getByLabelText("密码"), "correct-horse-battery-staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(runtime.signInUsername).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "使用 GitHub 登录" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "正在连接 GitHub…" })).not.toBeInTheDocument();

    resolveUsernameLogin?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "使用 GitHub 登录" })).toBeEnabled(),
    );
  });

  it("renders only the session username, signs out, and hides thrown details", async () => {
    const user = userEvent.setup();
    const runtime = client({
      useSession: () => ({
        data: { user: { username: "safe_user" } },
        isPending: false,
        refetch: vi.fn(async () => undefined),
      }),
      signOut: vi.fn(async () => {
        throw new Error("private alias and stack sentinel");
      }),
    });
    render(<AccountPanel client={runtime} />);

    expect(screen.getByText("safe_user")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("账户操作失败，请稍后重试");
    expect(document.body).not.toHaveTextContent("private alias and stack sentinel");
  });
});
