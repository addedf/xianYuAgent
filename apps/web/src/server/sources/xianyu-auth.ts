import { z } from "zod";
import type { ServerEnv } from "@/src/server/env";
import { requestXianyuCollector } from "./xianyu-collector-client";

const base64PngSchema = z.string().max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/);
const statusSchema = z.object({
  logged_in: z.boolean(),
  login_expired: z.boolean().optional(),
  status: z.string().optional(),
  verification_pending: z.boolean().optional(),
  verification_qr_image_base64: base64PngSchema.optional().or(z.literal("")),
});
const startSchema = z.object({
  session_id: z.string().regex(/^[a-f0-9]{32}$/i),
  qr_image_base64: base64PngSchema,
});
const smsStatusSchema = z.object({
  logged_in: z.boolean(),
  status: z.enum([
    "code_sent",
    "code_invalid",
    "verification_required",
    "authenticated",
    "expired",
  ]),
  session_id: z.string().regex(/^[a-f0-9]{32}$/i),
  resend_after: z.number().int().min(0).max(600).optional(),
});

export type XianyuConnectionState =
  | "disconnected"
  | "waiting_scan"
  | "scanned"
  | "confirming"
  | "verification_required"
  | "sms_code_sent"
  | "sms_code_invalid"
  | "sms_verification_required"
  | "authenticated"
  | "expired"
  | "canceled";

export interface XianyuAuthView {
  loggedIn: boolean;
  state: XianyuConnectionState;
  message: string;
  sessionId?: string;
  qrImageBase64?: string;
  method?: "qr" | "sms";
  resendAfter?: number;
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
  sms_code_sent: "验证码请求已提交，请查收短信后输入验证码。",
  sms_code_invalid: "验证码未通过，请检查后重试。",
  sms_verification_required: "请在弹出的闲鱼官方窗口完成安全验证。",
  authenticated: "闲鱼账号已连接，可以搜索真实商品。",
  expired: "二维码或登录会话已过期，请重新连接。",
  canceled: "本次登录已取消，请重新生成二维码。",
};

function connectionState(payload: z.infer<typeof statusSchema>): XianyuConnectionState {
  if (payload.logged_in) return "authenticated";
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
  };
}

function smsAuthView(payload: z.infer<typeof smsStatusSchema>): XianyuAuthView {
  const state: XianyuConnectionState = payload.logged_in || payload.status === "authenticated"
    ? "authenticated"
    : payload.status === "verification_required"
      ? "sms_verification_required"
      : payload.status === "code_invalid"
        ? "sms_code_invalid"
        : payload.status === "expired"
          ? "expired"
          : "sms_code_sent";
  return {
    loggedIn: state === "authenticated",
    state,
    message: messages[state],
    sessionId: payload.session_id,
    method: "sms",
    resendAfter: payload.resend_after,
  };
}

export async function getXianyuAuthStatus(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = statusSchema.parse(await requestXianyuCollector("/auth/status", { method: "GET" }, dependencies));
  return authView(payload);
}

export async function startXianyuQrLogin(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const current = await getXianyuAuthStatus(dependencies);
  if (current.loggedIn) return current;
  const started = startSchema.parse(await requestXianyuCollector("/auth/qr/start", { method: "POST" }, dependencies));
  return {
    loggedIn: false,
    state: "waiting_scan",
    message: messages.waiting_scan,
    sessionId: started.session_id,
    qrImageBase64: started.qr_image_base64,
    method: "qr",
  };
}

export async function pollXianyuQrLogin(sessionId: string, dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = statusSchema.parse(
    await requestXianyuCollector(`/auth/qr/status?session_id=${encodeURIComponent(sessionId)}`, { method: "GET" }, dependencies),
  );
  return { ...authView(payload, sessionId), method: "qr" };
}

export async function startXianyuSmsLogin(phone: string, dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = smsStatusSchema.parse(await requestXianyuCollector("/auth/sms/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  }, dependencies));
  return smsAuthView(payload);
}

export async function pollXianyuSmsLogin(sessionId: string, dependencies: AuthDependencies): Promise<XianyuAuthView> {
  const payload = smsStatusSchema.parse(await requestXianyuCollector(
    `/auth/sms/status?session_id=${encodeURIComponent(sessionId)}`,
    { method: "GET" },
    dependencies,
  ));
  return smsAuthView(payload);
}

export async function verifyXianyuSmsLogin(
  sessionId: string,
  code: string,
  dependencies: AuthDependencies,
): Promise<XianyuAuthView> {
  const payload = smsStatusSchema.parse(await requestXianyuCollector("/auth/sms/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, code }),
  }, dependencies));
  return smsAuthView(payload);
}

export async function logoutXianyu(dependencies: AuthDependencies): Promise<XianyuAuthView> {
  await requestXianyuCollector("/auth/logout", { method: "POST" }, dependencies);
  return { loggedIn: false, state: "disconnected", message: messages.disconnected };
}
