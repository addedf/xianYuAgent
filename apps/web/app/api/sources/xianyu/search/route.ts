import { ZodError } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { importXianyuSearch, ScanRunInProgressError } from "@/src/server/sources/xianyu-spider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  try {
    const result = await importXianyuSearch(await request.json().catch(() => null));
    return Response.json({ result });
  } catch (reason) {
    if (reason instanceof ZodError) {
      return Response.json({ error: "搜索条件不正确。", issues: reason.issues }, { status: 400 });
    }
    // 同一范围已有运行：复用/展示当前运行，不并发多轮（方案 7.2）。
    if (reason instanceof ScanRunInProgressError) {
      return Response.json({
        error: reason.message,
        code: "SCAN_RUN_IN_PROGRESS",
        runningRun: {
          id: reason.run.id,
          mode: reason.run.mode,
          startPage: reason.run.startPage,
          startedAt: reason.run.startedAt.toISOString(),
        },
      }, { status: 409 });
    }

    const message = reason instanceof Error ? reason.message : "闲鱼数据导入失败。";
    if (message.includes("登录")) {
      return Response.json({ error: message, code: "XIANYU_AUTH_REQUIRED" }, { status: 409 });
    }
    if (message.includes("尚未启用") || message.includes("尚未配置") || message.includes("官方安全验证")) {
      return Response.json({ error: message }, { status: 409 });
    }
    if (message.startsWith("本地闲鱼采集器") || message.startsWith("无法读取采集器") || message.startsWith("Web 与闲鱼采集器")) {
      return Response.json({ error: message }, { status: 502 });
    }
    return Response.json({ error: "闲鱼数据导入失败，请检查本机 PostgreSQL 和采集器终端输出。" }, { status: 500 });
  }
}
