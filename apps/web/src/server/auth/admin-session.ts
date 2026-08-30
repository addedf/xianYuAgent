import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "@/src/server/env";

export const ADMIN_SESSION_COOKIE = "xya_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

interface AdminSessionPayload {
  sub: "admin";
  issuedAt: number;
  expiresAt: number;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function adminAuthConfigurationError(env: ServerEnv): string | null {
  if (!env.ADMIN_PASSWORD) return "ADMIN_PASSWORD 尚未配置。";
  if (env.ADMIN_PASSWORD.length < 12) return "ADMIN_PASSWORD 至少需要 12 个字符。";
  if (env.ADMIN_SESSION_SECRET.length < 32) return "ADMIN_SESSION_SECRET 至少需要 32 个字符。";
  return null;
}

export function verifyAdminPassword(password: string, env: ServerEnv): boolean {
  return !adminAuthConfigurationError(env) && safeEqual(password, env.ADMIN_PASSWORD);
}

export function createAdminSessionToken(env: ServerEnv, now = Date.now()): string {
  const configurationError = adminAuthConfigurationError(env);
  if (configurationError) throw new Error(configurationError);

  const issuedAt = Math.floor(now / 1000);
  const payload: AdminSessionPayload = {
    sub: "admin",
    issuedAt,
    expiresAt: issuedAt + ADMIN_SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, env.ADMIN_SESSION_SECRET)}`;
}

export function verifyAdminSessionToken(token: string | undefined, env: ServerEnv, now = Date.now()): boolean {
  if (!token || adminAuthConfigurationError(env)) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, env.ADMIN_SESSION_SECRET))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AdminSessionPayload>;
    const current = Math.floor(now / 1000);
    return payload.sub === "admin"
      && Number.isInteger(payload.issuedAt)
      && Number.isInteger(payload.expiresAt)
      && Number(payload.issuedAt) <= current + 60
      && Number(payload.expiresAt) > current;
  } catch {
    return false;
  }
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: "/",
    priority: "high" as const,
  };
}
