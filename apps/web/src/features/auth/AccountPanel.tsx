import { Github, KeyRound, LogOut, ShieldCheck, UserRoundPlus } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { type AccountPanelClient, accountClient } from "./authClient";

export type { AccountPanelClient } from "./authClient";

type Mode = "login" | "register";

export function AccountPanel({ client = accountClient }: { readonly client?: AccountPanelClient }) {
  const titleId = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const session = client.useSession();

  useEffect(() => {
    const controller = new AbortController();
    void client
      .loadOptions(controller.signal)
      .then((options) => setGithubEnabled(options.githubEnabled))
      .catch(() => {
        if (!controller.signal.aborted) setGithubEnabled(false);
      });
    return () => controller.abort();
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const username = form.get("username");
    const password = form.get("password");
    if (typeof username !== "string" || typeof password !== "string") return;
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        if (!acknowledged) return;
        await client.register({
          acknowledgements: { noPasswordRecovery: true },
          password,
          username,
        });
      } else {
        await client.signInUsername({ password, username });
      }
      await session.refetch();
    } catch {
      setError("账户操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client.signOut();
      await session.refetch();
    } catch {
      setError("账户操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function signInGithub(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client.signInGithub();
    } catch {
      setError("账户操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (session.isPending) {
    return (
      <section className="account-panel" aria-busy="true" aria-labelledby={titleId}>
        <h2 id={titleId}>账户</h2>
        <output>正在确认登录状态…</output>
      </section>
    );
  }

  if (session.data) {
    return (
      <section className="account-panel" aria-labelledby={titleId}>
        <div>
          <ShieldCheck aria-hidden="true" />
          <div>
            <span>当前账户</span>
            <h2 id={titleId}>{session.data.user.username ?? "已登录用户"}</h2>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void signOut()}>
          <LogOut aria-hidden="true" /> 退出登录
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  const registering = mode === "register";
  return (
    <section className="account-panel" aria-labelledby={titleId}>
      <div>
        <KeyRound aria-hidden="true" />
        <div>
          <span>服务器增强</span>
          <h2 id={titleId}>登录后继续</h2>
        </div>
      </div>
      <div role="tablist" aria-label="账户操作">
        <button
          type="button"
          role="tab"
          aria-selected={!registering}
          onClick={() => setMode("login")}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={registering}
          onClick={() => setMode("register")}
        >
          注册
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {registering ? "注册用户名" : "用户名"}
          <input name="username" autoComplete="username" minLength={3} maxLength={30} required />
        </label>
        <label>
          {registering ? "注册密码" : "密码"}
          <input
            name="password"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        {registering ? (
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
            />
            我已知晓该账户不提供密码找回
          </label>
        ) : null}
        <button type="submit" disabled={busy || (registering && !acknowledged)}>
          {registering ? <UserRoundPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          {registering ? "创建账户" : "登录"}
        </button>
      </form>
      {githubEnabled ? (
        <button type="button" disabled={busy} onClick={() => void signInGithub()}>
          <Github aria-hidden="true" /> 使用 GitHub 登录
        </button>
      ) : null}
      <p>OpenTrad 不收集邮箱；用户名账户不提供密码找回。</p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
