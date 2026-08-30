import { ZodError } from "zod";
import { importXianyuSearch } from "@/src/server/sources/xianyu-spider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const result = await importXianyuSearch(await request.json().catch(() => null));
    return Response.json({ result });
  } catch (reason) {
    if (reason instanceof ZodError) {
      return Response.json({ error: "搜索条件不正确。", issues: reason.issues }, { status: 400 });
    }

    const message = reason instanceof Error ? reason.message : "闲鱼数据导入失败。";
    if (message.includes("尚未启用") || message.includes("尚未配置")) {
      return Response.json({ error: message }, { status: 409 });
    }
    if (message.startsWith("本地闲鱼采集器") || message.startsWith("无法读取采集器")) {
      return Response.json({ error: message }, { status: 502 });
    }
    return Response.json({ error: "闲鱼数据导入失败，请检查本机 PostgreSQL 和采集器终端输出。" }, { status: 500 });
  }
}
