import { Github, KeyRound, LogOut, ShieldCheck, UserRoundPlus } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { type AccountPanelClient, accountClient } from "./authClient";

export type { AccountPanelClient } from "./authClient";

type Mode = "login" | "register";

export function AccountPanel({ client = accountClient }: { readonly client?: AccountPanelClient }) {
  const titleId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const acknowledgementId = useId();
  const loginTabId = useId();
  const registerTabId = useId();
  const formPanelId = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
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
    setGithubBusy(true);
    setError("");
    try {
      await client.signInGithub();
    } catch {
      setError("账户操作失败，请稍后重试");
    } finally {
      setGithubBusy(false);
      setBusy(false);
    }
  }

  if (session.isPending) {
    return (
      <section
        className="account-panel account-panel--pending"
        aria-busy="true"
        aria-labelledby={titleId}
      >
        <div className="account-panel__heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <span>服务器增强</span>
            <h2 id={titleId}>正在确认账户</h2>
          </div>
        </div>
        <output className="account-panel__status">正在确认登录状态…</output>
      </section>
    );
  }

  if (session.data) {
    return (
      <section
        className="account-panel account-panel--authenticated"
        aria-busy={busy}
        aria-labelledby={titleId}
      >
        <div className="account-panel__heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <span>当前账户</span>
            <h2 id={titleId}>{session.data.user.username ?? "已登录用户"}</h2>
          </div>
        </div>
        <button
          className="account-panel__sign-out"
          type="button"
          disabled={busy}
          onClick={() => void signOut()}
        >
          <LogOut aria-hidden="true" /> 退出登录
        </button>
        {error ? (
          <p className="account-panel__alert" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const registering = mode === "register";
  return (
    <section className="account-panel" aria-busy={busy} aria-labelledby={titleId}>
      <div className="account-panel__heading">
        <KeyRound aria-hidden="true" />
        <div>
          <span>服务器增强</span>
          <h2 id={titleId}>登录后继续</h2>
        </div>
      </div>
      {githubEnabled ? (
        <>
          <button
            className="account-panel__github-action"
            type="button"
            disabled={busy}
            onClick={() => void signInGithub()}
          >
            <Github aria-hidden="true" /> {githubBusy ? "正在连接 GitHub…" : "使用 GitHub 登录"}
          </button>
          <div className="account-panel__divider">
            <span>或使用用户名</span>
          </div>
        </>
      ) : null}
      <div className="account-panel__tabs" role="tablist" aria-label="账户操作">
        <button
          id={loginTabId}
          className="account-panel__tab"
          type="button"
          role="tab"
          aria-selected={!registering}
          aria-controls={formPanelId}
          disabled={busy}
          onClick={() => setMode("login")}
        >
          登录
        </button>
        <button
          id={registerTabId}
          className="account-panel__tab"
          type="button"
          role="tab"
          aria-selected={registering}
          aria-controls={formPanelId}
          disabled={busy}
          onClick={() => setMode("register")}
        >
          注册
        </button>
      </div>
      <form
        id={formPanelId}
        className="account-panel__form"
        role="tabpanel"
        aria-labelledby={registering ? registerTabId : loginTabId}
        onSubmit={(event) => void submit(event)}
      >
        <label className="account-panel__field" htmlFor={usernameId}>
          {registering ? "注册用户名" : "用户名"}
          <input
            id={usernameId}
            name="username"
            autoComplete="username"
            minLength={3}
            maxLength={30}
            required
            disabled={busy}
          />
        </label>
        <label className="account-panel__field" htmlFor={passwordId}>
          {registering ? "注册密码" : "密码"}
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            minLength={12}
            maxLength={128}
            required
            disabled={busy}
          />
        </label>
        {registering ? (
          <label className="account-panel__acknowledgement" htmlFor={acknowledgementId}>
            <input
              id={acknowledgementId}
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
            />
            我已知晓该账户不提供密码找回
          </label>
        ) : null}
        <button
          className="account-panel__submit"
          type="submit"
          disabled={busy || (registering && !acknowledged)}
        >
          {registering ? <UserRoundPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          {busy ? "正在处理…" : registering ? "创建账户" : "登录"}
        </button>
      </form>
      <p className="account-panel__privacy">不收集邮箱 · 每次上传单独确认 · 任务结束自动清理</p>
      {error ? (
        <p className="account-panel__alert" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
