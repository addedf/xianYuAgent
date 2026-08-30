"use client";

import { useEffect, useState } from "react";
import { CircleNotch, LockKey, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ configured: boolean; authenticated: boolean }>)
      .then((session) => {
        setConfigured(session.configured);
        if (session.authenticated) router.replace("/");
      })
      .catch(() => setConfigured(false));
  }, [router]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "登录失败。");
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-mark" aria-hidden="true"><ShieldCheck size={28} weight="fill" /></div>
      <p className="context-line">本机管理员 · 8 小时会话</p>
      <h1 id="login-title">进入机会雷达</h1>
      <p>管理员登录后才能连接闲鱼账号、搜索真实商品或调用管理接口。</p>

      <form onSubmit={login}>
        <label>
          <span>管理员密码</span>
          <div className="login-input">
            <LockKey size={18} aria-hidden="true" />
            <input
              autoComplete="current-password"
              disabled={loading || configured === false}
              maxLength={256}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
        </label>
        <button className="button button-primary" disabled={loading || !password || configured === false} type="submit">
          {loading ? <CircleNotch className="spin" size={17} /> : <LockKey size={17} />}
          {loading ? "正在验证" : "安全登录"}
        </button>
      </form>

      {configured === false && (
        <div className="error-state" role="alert">
          <WarningCircle size={20} weight="fill" />
          请先在 .env.local 配置 ADMIN_PASSWORD 和 ADMIN_SESSION_SECRET。
        </div>
      )}
      {error && <div className="error-state" role="alert"><WarningCircle size={20} weight="fill" />{error}</div>}
      <small className="login-boundary">密码只在本机服务端验证，不会写入数据库或日志。</small>
    </section>
  );
}
