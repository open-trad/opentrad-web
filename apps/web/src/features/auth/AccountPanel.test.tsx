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
    await userEvent.click(github);
    expect(enabled.signInGithub).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(github).toBeEnabled());
    unmount();

    const disabled = client();
    render(<AccountPanel client={disabled} />);
    await waitFor(() => expect(disabled.loadOptions).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "使用 GitHub 登录" })).not.toBeInTheDocument();
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
