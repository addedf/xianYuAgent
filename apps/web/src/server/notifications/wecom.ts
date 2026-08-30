import { z } from "zod";
import type { ListingAssessment, MarketplaceListing } from "@/src/domain/listing";

const weComResponseSchema = z.object({
  errcode: z.number(),
  errmsg: z.string(),
});

export interface WeComDeliveryResult {
  ok: boolean;
  providerCode: number;
  message: string;
}

export function validateWeComWebhook(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("企业微信 Webhook 不是有效 URL。");
  }

  const allowedPath = "/cgi-bin/webhook/send";
  if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== allowedPath) {
    throw new Error("企业微信 Webhook 必须使用 qyapi.weixin.qq.com 的 HTTPS 机器人地址。");
  }

  if (!url.searchParams.get("key")) {
    throw new Error("企业微信 Webhook 缺少机器人 key。");
  }

  return url;
}

export async function sendWeComMarkdown(
  webhook: string,
  content: string,
  fetcher: typeof fetch = fetch,
): Promise<WeComDeliveryResult> {
  const url = validateWeComWebhook(webhook);
  const safeContent = content.trim().slice(0, 4000);
  if (!safeContent) throw new Error("企业微信通知内容不能为空。");

  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content: safeContent } }),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });

  if (!response.ok) {
    return { ok: false, providerCode: response.status, message: "企业微信 HTTP 请求失败。" };
  }

  const payload = weComResponseSchema.safeParse(await response.json());
  if (!payload.success) {
    return { ok: false, providerCode: -1, message: "企业微信返回了无法识别的响应。" };
  }

  return {
    ok: payload.data.errcode === 0,
    providerCode: payload.data.errcode,
    message: payload.data.errcode === 0 ? "通知已送达企业微信。" : `企业微信拒绝请求：${payload.data.errmsg}`,
  };
}

export function formatLeadNotification(listing: MarketplaceListing, assessment: ListingAssessment): string {
  const evidence = assessment.evidence
    .slice(0, 3)
    .map((item) => `- ${item.label}：${item.detail}`)
    .join("\n");

  return [
    "### 新的二奢货源线索",
    `> **${listing.brand} ${listing.model ?? ""}** · ¥${listing.price.toLocaleString("zh-CN")}`,
    `> ${listing.region} · 机会分 **${assessment.scores.totalOpportunity}** · 风险级别 **${assessment.riskLevel}**`,
    "",
    assessment.summary,
    "",
    "**主要依据**",
    evidence || "- 暂无足够依据，等待人工补充。",
    "",
    `规则版本：${assessment.rulesetVersion}`,
  ].join("\n");
}

