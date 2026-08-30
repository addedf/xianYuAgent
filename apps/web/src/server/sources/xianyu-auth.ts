import { z } from "zod";
import type { ServerEnv } from "@/src/server/env";
import { requestXianyuCollector } from "./xianyu-collector-client";

const sessionIdSchema = z.string().regex(/^[a-f0-9]{32}$/i);
const base64PngSchema = z.string().max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/);
const collectorCapabilitiesSchema = z.object({
  browser_login: z.boolean().optional(),
  qr_login: z.boolean().optional(),
  sms_login: z.boolean().optional(),
});
const statusSchema = z.object({
  logged_in: z.boolean(),
  login_expired: z.boolean().optional(),
  status: z.string().optional(),
  verification_pending: z.boolean().optional(),
  status_unavailable: z.boolean().optional(),
  verification_qr_image_base64: base64PngSchema.optional().or(z.literal("")),
  capabilities: collectorCapabilitiesSchema.optional(),
});
const qrStartSchema = z.object({
  session_id: sessionIdSchema,
  qr_image_base64: base64PngSchema,
});
const browserStatusSchema = z.object({
  session_id: sessionIdSchema,
  logged_in: z.boolean(),
  status: z.enum([
    "opening",
    "waiting_for_user",
    "authenticated",
    "expired",
    "canceled",
    "failed",
  ]),
  hint: z.string().optional(),
});

export type XianyuConnectionState =
  | "disconnected"
  | "waiting_scan"
  | "scanned"
  | "confirming"
  | "verification_required"
  | "browser_opening"
  | "browser_waiting"
  | "browser_failed"
  | "authenticated"
  | "expired"
  | "canceled"
  | "unavailable";

export interface XianyuAuthCapabilities {
  qrLogin: boolean;
  browserLogin: boolean;
}

export interface XianyuAuthView {
  loggedIn: boolean;
  state: XianyuConnectionState;
  message: string;
  sessionId?: string;
  qrImageBase64?: string;
  method?: "qr" | "browser";
  capabilities?: XianyuAuthCapabilities;
}

interface AuthDependencies {
  env: ServerEnv;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const messages: Record<XianyuConnectionState, string> = {
  disconnected: "尚未连接闲鱼账号。",
  waiting_scan: "请使用闲鱼 App 扫描二维码。",
  scanned: "已扫码，请在闲鱼 App 中确认登录。",
  confirming: "已确认，正在建立登录会话。",
  verification_required: "闲鱼要求额外验证，请在 App 中按官方提示完成。",
  browser_opening: "正在打开闲鱼官方登录窗口。",
  browser_waiting: "官方登录窗口已打开，等待本人完成登录和安全验证。",
  browser_failed: "官方登录窗口未能完成登录，请确认窗口可见后重新尝试。",
  authenticated: "闲鱼账号已连接，可以搜索真实商品。",
  expired: "登录会话已过期，请重新连接。",
  canceled: "本次登录已取消，请重新选择登录方式。",
  unavailable: "暂时无法向闲鱼确认登录状态；本机登录态已保留，请稍后刷新。",
};

function capabilities(payload: z.infer<typeof statusSchema>): XianyuAuthCapabilities {
  return {
    // QR is supported by collectors predating capability declarations.
    qrLogin: payload.capabilities?.qr_login ?? true,
    browserLogin: payload.capabilities?.browser_login === true,
  };
}

function connectionState(payload: z.infer<typeof statusSchema>): XianyuConnectionState {
  if (payload.logged_in) return "authenticated";
  if (payload.status_unavailable) return "unavailable";
  if (payload.login_expired) return "expired";
  if (payload.verification_pending || payload.status === "verification_required") return "verification_required";
  if (payload.status === "scanned") return "scanned";
  if (payload.status === "confirmed") return "confirming";
  if (payload.status === "expired") return "expired";
  if (payload.status === "canceled") return "canceled";
  if (payload.status === "new") return "waiting_scan";
  return "disconnected";
}

function authView(payload: z.infer<typeof statusSchema>, sessionId?: string): XianyuAuthView {
  const state = connectionState(payload);
  return {
    loggedIn: payload.logged_in,
    state,
    message: messages[state],
    sessionId,
    qrImageBase64: payload.verification_qr_image_base64 || undefined,
    capabilities: capabilities(payload),
  };
}

function browserAuthView(payload: z.infer<typeof browserStatusSchema>): XianyuAuthView {
  const state: XianyuConnectionState = payload.logged_in || payload.status === "authenticated"
    ? "authenticated"
    : payload.status === "opening"
      ? "browser_opening"
      : payload.status === "waiting_for_user"
        ? "browser_waiting"
        : payload.status === "expired"
          ? "expired"
          : payload.status === "canceled"
            ? "canceled"
            : "browser_failed";

  return {
    loggedIn: state === "authenticated",
    state,
    message: messages[state],
    sessionId: payload.session_id,
    method: "browser",
    capabilities: { qrLogin: true, browserLogin: true },
  };
}

export async function getXianyuAuthStatus(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = statusSchema.parse(await requestXianyuCollector("/auth/status", { method: "GET" }, dependencies));
  return authView(payload);
}

export async function startXianyuQrLogin(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const current = await getXianyuAuthStatus(dependencies);
  if (current.loggedIn) return current;
  const started = qrStartSchema.parse(await requestXianyuCollector("/auth/qr/start", { method: "POST" }, dependencies));
  return {
    loggedIn: false,
    state: "waiting_scan",
    message: messages.waiting_scan,
    sessionId: started.session_id,
    qrImageBase64: started.qr_image_base64,
    method: "qr",
    capabilities: current.capabilities,
  };
}

export async function pollXianyuQrLogin(sessionId: string, dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = statusSchema.parse(
    await requestXianyuCollector(`/auth/qr/status?session_id=${encodeURIComponent(sessionId)}`, { method: "GET" }, dependencies),
  );
  return { ...authView(payload, sessionId), method: "qr" };
}

export async function startXianyuBrowserLogin(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const current = await getXianyuAuthStatus(dependencies);
  if (current.loggedIn) return current;
  if (!current.capabilities?.browserLogin) {
    throw new Error("当前闲鱼采集器版本不支持官方窗口登录，请升级采集器或使用扫码登录。");
  }
  const payload = browserStatusSchema.parse(await requestXianyuCollector(
    "/auth/browser/start",
    { method: "POST" },
    dependencies,
  ));
  return browserAuthView(payload);
}

export async function pollXianyuBrowserLogin(
  sessionId: string,
  dependencies: AuthDependencies,
): Promise<XianyuAuthView> {
  const payload = browserStatusSchema.parse(await requestXianyuCollector(
    `/auth/browser/status?session_id=${encodeURIComponent(sessionId)}`,
    { method: "GET" },
    dependencies,
  ));
  return browserAuthView(payload);
}

export async function cancelXianyuBrowserLogin(
  sessionId: string,
  dependencies: AuthDependencies,
): Promise<XianyuAuthView> {
  const payload = browserStatusSchema.parse(await requestXianyuCollector(
    `/auth/browser/cancel?session_id=${encodeURIComponent(sessionId)}`,
    { method: "POST" },
    dependencies,
  ));
  return browserAuthView(payload);
}

export async function logoutXianyu(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  await requestXianyuCollector("/auth/logout", { method: "POST" }, dependencies);
  return {
    loggedIn: false,
    state: "disconnected",
    message: messages.disconnected,
  };
}
