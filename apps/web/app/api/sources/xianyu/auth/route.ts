import { z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getServerEnv } from "@/src/server/env";
import {
  cancelXianyuBrowserLogin,
  getXianyuAuthStatus,
  logoutXianyu,
  pollXianyuBrowserLogin,
  pollXianyuQrLogin,
  startXianyuBrowserLogin,
  startXianyuQrLogin,
} from "@/src/server/sources/xianyu-auth";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), sessionId: z.string().regex(/^[a-f0-9]{32}$/i) }),
  z.object({ action: z.literal("browser_start") }),
  z.object({ action: z.literal("browser_poll"), sessionId: z.string().regex(/^[a-f0-9]{32}$/i) }),
  z.object({ action: z.literal("browser_cancel"), sessionId: z.string().regex(/^[a-f0-9]{32}$/i) }),
  z.object({ action: z.literal("logout") }),
]);

function safeErrorMessage(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  const safePrefixes = [
    "闲鱼只读采集器",
    "闲鱼采集器",
    "闲鱼要求",
    "XIANYU_COLLECTOR_API_TOKEN",
    "Web 与闲鱼采集器",
    "本地闲鱼采集器",
    "当前闲鱼采集器版本",
  ];
  return safePrefixes.some((prefix) => reason.message.startsWith(prefix)) ? reason.message : fallback;
}

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;
  try {
    return Response.json({ auth: await getXianyuAuthStatus({ env: getServerEnv() }) });
  } catch (reason) {
    return Response.json({ error: safeErrorMessage(reason, "无法读取闲鱼登录状态。") }, { status: 502 });
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
      case "browser_start":
        auth = await startXianyuBrowserLogin(dependencies);
        break;
      case "browser_poll":
        auth = await pollXianyuBrowserLogin(parsed.data.sessionId, dependencies);
        break;
      case "browser_cancel":
        auth = await cancelXianyuBrowserLogin(parsed.data.sessionId, dependencies);
        break;
      case "logout":
        auth = await logoutXianyu(dependencies);
        break;
      default: {
        const exhaustiveAction: never = parsed.data;
        void exhaustiveAction;
        return Response.json({ error: "登录操作格式不正确。" }, { status: 400 });
      }
    }
    return Response.json({ auth });
  } catch (reason) {
    return Response.json({ error: safeErrorMessage(reason, "闲鱼登录操作失败，请检查本机采集器状态。") }, { status: 502 });
  }
}
