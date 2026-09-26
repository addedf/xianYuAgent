import { z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { sellers } from "@/src/server/db/schema";
import { blacklistSellerByRow } from "@/src/server/exclusions";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const blacklistSchema = z.object({
  sellerId: z.uuid(),
  reason: z.enum(["manual-suspicion", "merchant-name", "seller-frequency", "dup-title", "sold-count"]).default("manual-suspicion"),
  note: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = blacklistSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const [seller] = await db
      .select({ externalId: sellers.externalId, displayName: sellers.displayName, region: sellers.region })
      .from(sellers)
      .where(and(eq(sellers.platform, "xianyu"), eq(sellers.id, payload.sellerId)))
      .limit(1);
    if (!seller) {
      return Response.json({ error: "未找到该卖家记录。" }, { status: 404 });
    }
    const outcome = await blacklistSellerByRow({
      displayName: seller.displayName ?? "",
      region: seller.region ?? "",
      stableExternalId: seller.externalId.startsWith("xianyu-user-") ? seller.externalId : undefined,
      reason: payload.reason,
      note: payload.note,
    });
    // 返回真实完成情况：写入了哪些身份键、影响多少存量线索、弱身份的局限说明。
    return Response.json({
      ok: true,
      exclusions: outcome.exclusions.map((row) => ({ id: row.id, identityKey: row.identityKey, identityType: row.identityType })),
      affectedActiveListings: outcome.affectedActiveListings,
      identityType: outcome.identityType,
      scopeNotice: outcome.scopeNotice,
    });
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "拉黑参数不正确。" }, { status: 400 });
    }
    const message = reason instanceof Error ? reason.message : "拉黑保存失败，请检查数据库连接后重试。";
    const status = message.includes("匿名占位") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
