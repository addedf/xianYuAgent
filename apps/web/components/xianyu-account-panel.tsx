"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  QrCode,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";
import { mergeXianyuAuthPoll } from "./xianyu-account-state";

type AuthResponse = { auth?: XianyuAuthView; error?: string };
type AuthAction =
  | { action: "start" }
  | { action: "poll"; sessionId: string }
  | { action: "sms_start"; phone: string }
  | { action: "sms_poll"; sessionId: string }
  | { action: "sms_verify"; sessionId: string; code: string }
  | { action: "logout" };

export function XianyuAccountPanel() {
  const [auth, setAuth] = useState<XianyuAuthView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginMode, setLoginMode] = useState<"qr" | "sms">("qr");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsCooldown, setSmsCooldown] = useState(0);

  async function requestAuth(body?: AuthAction) {
    const response = await fetch("/api/sources/xianyu/auth", body ? {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    } : { cache: "no-store" });
    const result = (await response.json()) as AuthResponse;
    if (!response.ok || !result.auth) throw new Error(result.error || "无法读取闲鱼账号状态。");
    const nextAuth = result.auth;
    setAuth((current) => body?.action === "poll"
      ? mergeXianyuAuthPoll(current, nextAuth)
      : nextAuth);
    return nextAuth;
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sources/xianyu/auth", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as AuthResponse;
        if (!response.ok || !result.auth) throw new Error(result.error || "无法读取闲鱼账号状态。");
        if (!cancelled) setAuth(result.auth);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取闲鱼账号状态。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setSmsCooldown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [smsCooldown]);

  useEffect(() => {
    if (loading || !auth?.sessionId || auth.loggedIn || ["expired", "canceled"].includes(auth.state)) return;
    let cancelled = false;
    let timer: number | undefined;
    const sessionId = auth.sessionId;
    const poll = async () => {
      try {
        await requestAuth(auth.method === "sms"
          ? { action: "sms_poll", sessionId }
          : { action: "poll", sessionId });
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "登录状态轮询失败。");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 2_000);
      }
    };
    timer = window.setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [auth?.loggedIn, auth?.method, auth?.sessionId, auth?.state, loading]);

  async function perform(action: "start" | "logout") {
    setLoading(true);
    setError(null);
    try {
      await requestAuth({ action });
      if (action === "start") setLoginMode("qr");
      if (action === "logout") {
        setSmsCode("");
        setSmsCooldown(0);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "闲鱼账号操作失败。");
    } finally {
      setLoading(false);
    }
  }

  async function sendSmsCode() {
    const normalizedPhone = phone.replace(/[\s-]/g, "");
    if (!/^(?:\+?86)?1[3-9]\d{9}$/.test(normalizedPhone)) {
      setError("请输入有效的中国大陆手机号。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await requestAuth({ action: "sms_start", phone: normalizedPhone });
      setLoginMode("sms");
      setSmsCooldown(next.resendAfter ?? 60);
      setSmsCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "短信验证码发送失败。");
    } finally {
      setLoading(false);
    }
  }

  async function verifySmsCode() {
    if (!auth?.sessionId || auth.method !== "sms") {
      setError("请先发送短信验证码。");
      return;
    }
    if (!/^\d{4,8}$/.test(smsCode)) {
      setError("请输入短信中的验证码。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestAuth({ action: "sms_verify", sessionId: auth.sessionId, code: smsCode });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "短信验证码登录失败。");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAuth() {
    setLoading(true);
    setError(null);
    try {
      if (!auth?.loggedIn && auth?.sessionId) {
        await requestAuth(auth.method === "sms"
          ? { action: "sms_poll", sessionId: auth.sessionId }
          : { action: "poll", sessionId: auth.sessionId });
      } else {
        await requestAuth();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新失败。");
    } finally {
      setLoading(false);
    }
  }

  const connected = auth?.loggedIn === true;

  return (
    <section className="panel xianyu-account-panel" id="xianyu-account">
      <div className="section-heading">
        <div>
          <h2>闲鱼账号连接</h2>
          <p>二维码由 Web 服务端向本机采集器申请；账号会话始终留在采集器中。</p>
        </div>
        {connected
          ? <CheckCircle className="account-ok" size={24} weight="fill" aria-hidden="true" />
          : <QrCode size={24} weight="fill" aria-hidden="true" />}
      </div>

      <div className="account-body">
        <div className="account-status">
          <span className={`account-state account-state-${connected ? "ready" : "idle"}`}>
            {connected ? "已连接" : loading ? "检查中" : "未连接"}
          </span>
          <strong>{auth?.message || "正在检查闲鱼登录状态…"}</strong>
          <p>Cookie 和 Token 始终留在本机采集器；手机号与验证码只用于提交到闲鱼官方登录页，不保存、不回显。</p>
          {!connected && (
            <div className="account-login-tabs" role="tablist" aria-label="闲鱼登录方式">
              <button aria-selected={loginMode === "qr"} onClick={() => setLoginMode("qr")} role="tab" type="button">扫码登录</button>
              <button aria-selected={loginMode === "sms"} onClick={() => setLoginMode("sms")} role="tab" type="button">验证码登录</button>
            </div>
          )}

          {!connected && loginMode === "qr" && (
            <div className="account-actions">
              <button className="button button-primary" disabled={loading} onClick={() => perform("start")} type="button">
                {loading ? <CircleNotch className="spin" size={17} /> : <QrCode size={17} />}
                {auth?.method === "qr" && auth.sessionId ? "重新生成二维码" : "生成登录二维码"}
              </button>
            </div>
          )}

          {!connected && loginMode === "sms" && (
            <form className="account-sms-form" onSubmit={(event) => {
              event.preventDefault();
              verifySmsCode();
            }}>
              <label>
                <span>手机号</span>
                <div className="account-sms-row">
                  <input
                    autoComplete="tel"
                    inputMode="tel"
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="中国大陆手机号"
                    value={phone}
                  />
                  <button className="button button-secondary" disabled={loading || smsCooldown > 0} onClick={sendSmsCode} type="button">
                    {smsCooldown > 0 ? `${smsCooldown} 秒后重发` : "发送验证码"}
                  </button>
                </div>
              </label>
              <label>
                <span>短信验证码</span>
                <div className="account-sms-row">
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, ""))}
                    placeholder="请输入验证码"
                    value={smsCode}
                  />
                  <button className="button button-primary" disabled={loading || auth?.method !== "sms" || !smsCode} type="submit">
                    {loading ? <CircleNotch className="spin" size={17} /> : null}登录闲鱼
                  </button>
                </div>
              </label>
              <small>发送时会打开闲鱼官方登录窗口；如出现滑块或人脸验证，请在该窗口完成。</small>
            </form>
          )}

          <div className="account-actions">
            <button className="button button-secondary" disabled={loading} onClick={refreshAuth} type="button">
              <ArrowClockwise className={loading ? "spin" : ""} size={17} />刷新状态
            </button>
            {connected && (
              <button className="button button-ghost" disabled={loading} onClick={() => perform("logout")} type="button">
                <SignOut size={17} />断开闲鱼
              </button>
            )}
          </div>
        </div>

        {auth?.qrImageBase64 && !connected && loginMode === "qr" && (
          <div className="account-qr">
            <Image
              alt={auth.state === "verification_required" ? "闲鱼官方验证二维码" : "闲鱼登录二维码"}
              height={256}
              priority
              src={`data:image/png;base64,${auth.qrImageBase64}`}
              unoptimized
              width={256}
            />
            <small>{auth.state === "verification_required" ? "按闲鱼 App 的官方提示完成额外验证" : "使用闲鱼 App 扫一扫并在手机上确认"}</small>
          </div>
        )}
      </div>

      {error && <div className="error-state" role="alert"><WarningCircle size={20} weight="fill" />{error}</div>}
    </section>
  );
}
