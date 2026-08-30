import { NextResponse } from "next/server";
import { adminApiError } from "@/src/server/auth/admin-request";
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions } from "@/src/server/auth/admin-session";

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions(), maxAge: 0 });
  return response;
}
