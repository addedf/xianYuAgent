import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/src/server/auth/admin-request";
import {
  ADMIN_SESSION_COOKIE,
  adminAuthConfigurationError,
  adminSessionCookieOptions,
  createAdminSessionToken,
  verifyAdminPassword,
} from "@/src/server/auth/admin-session";
import { getServerEnv } from "@/src/server/env";

const loginSchema = z.object({ password: z.string().min(1).max(256) });
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 5;

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local";
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "请求来源校验失败。" }, { status: 403 });

  const env = getServerEnv();
  const configurationError = adminAuthConfigurationError(env);
  if (configurationError) return Response.json({ error: configurationError }, { status: 503 });

  const key = clientKey(request);
  const now = Date.now();
  const current = attempts.get(key);
  const attempt = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  if (attempt.count >= MAX_ATTEMPTS) {
    return Response.json({ error: "登录尝试过多，请稍后再试。" }, { status: 429 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyAdminPassword(parsed.data.password, env)) {
    attempts.set(key, { ...attempt, count: attempt.count + 1 });
    return Response.json({ error: "管理员密码不正确。" }, { status: 401 });
  }

  attempts.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(env), adminSessionCookieOptions());
  return response;
}
