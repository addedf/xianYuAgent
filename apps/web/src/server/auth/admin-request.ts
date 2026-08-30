import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/src/server/env";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./admin-session";

function cookieValue(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([key]) => key === name)?.[1];
}

export function isAdminApiRequest(request: Request): boolean {
  const env = getServerEnv();
  const token = cookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  return verifyAdminSessionToken(token, env);
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const expectedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || requestUrl.host;
    const expectedProtocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

export function adminApiError(request: Request, mutation = false): Response | null {
  if (!isAdminApiRequest(request)) return Response.json({ error: "管理员登录已失效，请重新登录。" }, { status: 401 });
  if (mutation && !isSameOriginMutation(request)) return Response.json({ error: "请求来源校验失败。" }, { status: 403 });
  return null;
}

export async function requireAdminPage(): Promise<void> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifyAdminSessionToken(token, getServerEnv())) redirect("/login");
}
