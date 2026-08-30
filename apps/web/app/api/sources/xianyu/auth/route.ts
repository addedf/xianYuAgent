import { z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getServerEnv } from "@/src/server/env";
import {
  getXianyuAuthStatus,
  logoutXianyu,
  pollXianyuQrLogin,
  pollXianyuSmsLogin,
  startXianyuQrLogin,
  startXianyuSmsLogin,
  verifyXianyuSmsLogin,
} from "@/src/server/sources/xianyu-auth";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), sessionId: z.string().regex(/^[a-f0-9]{32}$/i) }),
  z.object({ action: z.literal("sms_start"), phone: z.string().regex(/^(?:\+?86)?1[3-9]\d{9}$/) }),
  z.object({ action: z.literal("sms_poll"), sessionId: z.string().regex(/^[a-f0-9]{32}$/i) }),
  z.object({
    action: z.literal("sms_verify"),
    sessionId: z.string().regex(/^[a-f0-9]{32}$/i),
    code: z.string().regex(/^\d{4,8}$/),
  }),
  z.object({ action: z.literal("logout") }),
]);

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;
  try {
    return Response.json({ auth: await getXianyuAuthStatus({ env: getServerEnv() }) });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "无法读取闲鱼登录状态。" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "登录操作格式不正确。" }, { status: 400 });

  try {
    const dependencies = { env: getServerEnv() };
    let auth;
    switch (parsed.data.action) {
      case "start":
        auth = await startXianyuQrLogin(dependencies);
        break;
      case "poll":
        auth = await pollXianyuQrLogin(parsed.data.sessionId, dependencies);
        break;
      case "sms_start":
        auth = await startXianyuSmsLogin(parsed.data.phone, dependencies);
        break;
      case "sms_poll":
        auth = await pollXianyuSmsLogin(parsed.data.sessionId, dependencies);
        break;
      case "sms_verify":
        auth = await verifyXianyuSmsLogin(parsed.data.sessionId, parsed.data.code, dependencies);
        break;
      default:
        auth = await logoutXianyu(dependencies);
    }
    return Response.json({ auth });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "闲鱼登录操作失败。" }, { status: 502 });
  }
}
