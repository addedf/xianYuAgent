import { getServerEnv } from "@/src/server/env";
import { sendWeComMarkdown } from "@/src/server/notifications/wecom";

export async function POST() {
  const { WECOM_WEBHOOK_URL } = getServerEnv();
  if (!WECOM_WEBHOOK_URL) {
    return Response.json({ error: "WECOM_WEBHOOK_URL 尚未配置。" }, { status: 400 });
  }

  try {
    const result = await sendWeComMarkdown(
      WECOM_WEBHOOK_URL,
      [
        "### 闲鱼二奢机会雷达连接测试",
        "> 企业微信通知链路已由本地工作台发起。",
        "",
        `测试时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      ].join("\n"),
    );
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "企业微信通知测试失败。" },
      { status: 400 },
    );
  }
}

