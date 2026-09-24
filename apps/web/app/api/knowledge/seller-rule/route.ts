import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { ruleDefinitions, ruleVersions } from "@/src/server/db/schema";
import { SELLER_RULE_CODE, SELLER_RULE_TITLE } from "@/src/server/seller-rule-settings";

export const runtime = "nodejs";

const payloadSchema = z.object({
  sameCategoryMinCount: z.number().int().min(1).max(10_000),
  completedSaleMinCount: z.number().int().min(0).max(10_000_000),
  changeReason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = payloadSchema.parse(await request.json().catch(() => null));
    const thresholds = { sameCategoryMinCount: payload.sameCategoryMinCount, completedSaleMinCount: payload.completedSaleMinCount };
    const { db } = getDatabase();
    const version = await db.transaction(async (tx) => {
      const [definition] = await tx.select().from(ruleDefinitions)
        .where(eq(ruleDefinitions.code, SELLER_RULE_CODE)).limit(1).for("update");
      const nextVersion = (definition?.currentVersion ?? 0) + 1;
      let ruleId = definition?.id;
      if (!definition) {
        const [created] = await tx.insert(ruleDefinitions).values({
          code: SELLER_RULE_CODE,
          title: SELLER_RULE_TITLE,
          category: "seller",
          currentVersion: nextVersion,
          enabled: true,
        }).returning({ id: ruleDefinitions.id });
        ruleId = created.id;
      } else {
        await tx.update(ruleDefinitions).set({ title: SELLER_RULE_TITLE, enabled: true, currentVersion: nextVersion, updatedAt: new Date() })
          .where(eq(ruleDefinitions.id, definition.id));
      }
      await tx.insert(ruleVersions).values({
        ruleId: ruleId!,
        version: nextVersion,
        conditions: thresholds,
        scoreImpact: -20,
        explanationTemplate: "同品类已采集商品数达到阈值，或已核实售出数超过阈值时，标记疑似非个人卖家并降低个人卖家概率。",
        changeReason: payload.changeReason,
        approvedBy: "local-user",
      });
      return nextVersion;
    });
    return Response.json({ ok: true, version, thresholds });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "规则内容不正确。" }, { status: 400 });
    return Response.json({ error: "规则保存失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}
