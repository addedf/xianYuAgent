"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  Browser,
  CheckCircle,
  CircleNotch,
  QrCode,
  SignOut,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";
import {
  failXianyuAuthPoll,
  isXianyuAuthTerminal,
  mergeXianyuAuthPoll,
  xianyuAuthPollAction,
} from "./xianyu-account-state";

type AuthResponse = { auth?: XianyuAuthView; error?: string };
type AuthAction =
  | { action: "start" }
  | { action: "poll"; sessionId: string }
  | { action: "browser_start" }
  | { action: "browser_poll"; sessionId: string }
  | { action: "browser_cancel"; sessionId: string }
  | { action: "logout" };

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export function XianyuAccountPanel() {
  const [auth, setAuth] = useState<XianyuAuthView | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginMode, setLoginMode] = useState<"qr" | "browser">("browser");
  const pollAbortRef = useRef<AbortController | null>(null);
  const authGenerationRef = useRef(0);

  const requestAuth = useCallback(async (
    body?: AuthAction,
    signal?: AbortSignal,
    expectedGeneration?: number,
  ) => {
    const response = await fetch("/api/sources/xianyu/auth", body ? {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    } : { cache: "no-store", signal });
    const result = await response.json().catch(() => ({})) as AuthResponse;
    if (!response.ok || !result.auth) throw new Error(result.error || "无法读取闲鱼账号状态。");
    const nextAuth = result.auth;
    if (expectedGeneration === undefined || authGenerationRef.current === expectedGeneration) {
      setAuth((current) => mergeXianyuAuthPoll(current, nextAuth));
    }
    return nextAuth;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = authGenerationRef.current;
    requestAuth(undefined, controller.signal, generation)
      .catch((reason: unknown) => {
        if (!isAbortError(reason)) {
          setError(reason instanceof Error ? reason.message : "无法读取闲鱼账号状态。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestAuth]);

  const pollAction = xianyuAuthPollAction(auth);
  const pollKind = pollAction?.action;
  const pollSessionId = pollAction?.sessionId;

  useEffect(() => {
    if (!pollKind || !pollSessionId) return;

    let stopped = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (!stopped) timer = window.setTimeout(poll, delay);
    };
    const poll = async () => {
      const controller = new AbortController();
      const generation = authGenerationRef.current;
      pollAbortRef.current = controller;
      setPolling(true);
      let nextDelay: number | null = null;
      try {
        const next = await requestAuth(
          pollKind === "browser_poll"
            ? { action: "browser_poll", sessionId: pollSessionId }
            : { action: "poll", sessionId: pollSessionId },
          controller.signal,
          generation,
        );
        if (!stopped && authGenerationRef.current === generation) {
          consecutiveFailures = 0;
          setError(null);
          if (!isXianyuAuthTerminal(next)) nextDelay = 2_000;
        }
      } catch (reason) {
        if (!stopped && !isAbortError(reason)) {
          consecutiveFailures += 1;
          setError(reason instanceof Error ? reason.message : "登录状态轮询失败。");
          if (consecutiveFailures < 3) {
            nextDelay = 4_000;
          } else {
            setAuth((current) => (
              current?.sessionId === pollSessionId ? failXianyuAuthPoll(current) : current
            ));
          }
        }
      } finally {
        if (pollAbortRef.current === controller) pollAbortRef.current = null;
        if (!stopped) setPolling(false);
        if (nextDelay !== null) schedule(nextDelay);
      }
    };

    schedule(2_000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, [pollKind, pollSessionId, requestAuth]);

  async function perform(action: "start" | "browser_start" | "logout") {
    authGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    setLoading(true);
    setError(null);
    try {
      const next = await requestAuth({ action });
      if (action === "start") setLoginMode("qr");
      if (action === "browser_start") setLoginMode("browser");
      if (next.loggedIn) setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "闲鱼账号操作失败。");
    } finally {
      setLoading(false);
    }
  }

  async function cancelBrowserLogin() {
    if (!auth?.sessionId || auth.method !== "browser") return;
    authGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    setLoading(true);
    setError(null);
    try {
      await requestAuth({ action: "browser_cancel", sessionId: auth.sessionId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法取消官方窗口登录。");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAuth() {
    authGenerationRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      await requestAuth();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新失败。");
    } finally {
      setLoading(false);
    }
  }

  const connected = auth?.loggedIn === true;
  const activeSession = pollAction !== null;
  const browserSupported = auth?.capabilities?.browserLogin === true;
  const activeLoginMode = browserSupported ? loginMode : "qr";
  const browserSessionActive = activeSession && auth?.method === "browser";
  const statusLabel = connected
    ? "已连接"
    : auth?.state === "unavailable"
      ? "暂不可确认"
    : browserSessionActive
      ? "等待本人操作"
      : loading
        ? "检查中"
        : "未连接";

  return (
    <section className="panel xianyu-account-panel" id="xianyu-account">
      <div className="section-heading">
        <div>
          <h2>闲鱼账号连接</h2>
          <p>Web 只发起登录并读取脱敏状态；账号会话始终留在本机采集器中。</p>
        </div>
        {connected
          ? <CheckCircle className="account-ok" size={24} weight="fill" aria-hidden="true" />
          : <Browser size={24} weight="fill" aria-hidden="true" />}
      </div>

      <div className="account-body">
        <div className="account-status">
          <span className={`account-state account-state-${connected ? "ready" : "idle"}`}>
            {statusLabel}
          </span>
          <strong>{auth?.message || "正在检查闲鱼登录状态…"}</strong>
          <p>Cookie 不进入 Web；服务令牌只在 Web 服务端连接本机采集器，手机号与验证码只在闲鱼官方页面中由本人输入。</p>

          {!connected && browserSupported && (
            <div className="account-login-tabs" role="tablist" aria-label="闲鱼登录方式">
              <button
                aria-controls="xianyu-qr-login"
                aria-selected={activeLoginMode === "qr"}
                disabled={activeSession}
                id="xianyu-qr-tab"
                onClick={() => setLoginMode("qr")}
                role="tab"
                type="button"
              >扫码登录</button>
              <button
                aria-controls="xianyu-browser-login"
                aria-selected={activeLoginMode === "browser"}
                disabled={activeSession}
                id="xianyu-browser-tab"
                onClick={() => setLoginMode("browser")}
                role="tab"
                type="button"
              >官方窗口登录</button>
            </div>
          )}

          {!connected && auth && !browserSupported && (
            <p className="account-capability-note">
              当前采集器版本未提供官方窗口登录能力；可继续扫码，或升级本机采集器后再使用。
            </p>
          )}

          {!connected && activeLoginMode === "qr" && (
            <div
              aria-labelledby={browserSupported ? "xianyu-qr-tab" : undefined}
              className="account-login-panel"
              id="xianyu-qr-login"
              role={browserSupported ? "tabpanel" : undefined}
            >
              <div className="account-actions">
                <button className="button button-primary" disabled={loading || activeSession} onClick={() => perform("start")} type="button">
                  {loading ? <CircleNotch className="spin" size={17} /> : <QrCode size={17} />}
                  {auth?.method === "qr" && auth.sessionId ? "重新生成二维码" : "生成登录二维码"}
                </button>
              </div>
            </div>
          )}

          {!connected && browserSupported && activeLoginMode === "browser" && (
            <div
              aria-labelledby="xianyu-browser-tab"
              className="account-browser-login account-login-panel"
              id="xianyu-browser-login"
              role="tabpanel"
            >
              <ol className="account-browser-steps">
                <li>点击后，本机会弹出闲鱼官方登录页面。</li>
                <li>在官方页面选择短信验证码登录，并由本人输入手机号和验证码。</li>
                <li>如出现滑块或人脸验证，请在该窗口按官方提示本人完成。</li>
              </ol>
              <div className="account-actions">
                <button
                  className="button button-primary"
                  disabled={loading || browserSessionActive}
                  onClick={() => perform("browser_start")}
                  type="button"
                >
                  {loading ? <CircleNotch className="spin" size={17} /> : <Browser size={17} />}
                  {auth?.method === "browser" && auth.sessionId ? "重新打开官方登录窗口" : "打开闲鱼官方登录窗口"}
                </button>
                {browserSessionActive && (
                  <button className="button button-secondary" disabled={loading} onClick={cancelBrowserLogin} type="button">
                    <XCircle size={17} />取消本次登录
                  </button>
                )}
              </div>
              {browserSessionActive && (
                <small className="account-browser-progress" role="status">
                  {polling ? "正在检查登录结果…" : "等待官方页面完成登录，Web 将自动更新状态。"}
                </small>
              )}
            </div>
          )}

          <div className="account-actions">
            <button className="button button-secondary" disabled={loading || activeSession} onClick={refreshAuth} type="button">
              <ArrowClockwise className={loading ? "spin" : ""} size={17} />
              {activeSession ? "自动检查中" : "刷新状态"}
            </button>
            {connected && (
              <button className="button button-ghost" disabled={loading} onClick={() => perform("logout")} type="button">
                <SignOut size={17} />断开闲鱼
              </button>
            )}
          </div>
        </div>

        {auth?.qrImageBase64 && !connected && activeLoginMode === "qr" && (
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
