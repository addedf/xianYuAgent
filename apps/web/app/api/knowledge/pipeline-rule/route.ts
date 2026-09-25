import { desc, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { COUNTERFEIT_TERMS_FILTER_CODE, DEFAULT_PRE_FILTER_CONFIGS, EXTREME_PRICE_GAP_FILTER_CODE, SELLER_NON_PERSONAL_FILTER_CODE } from "@/src/domain/pre-filters";
import { DEFAULT_SELLER_RULE_THRESHOLDS } from "@/src/domain/seller-rules";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { ruleDefinitions, ruleVersions } from "@/src/server/db/schema";

export const runtime = "nodejs";

const codeSchema = z.enum([COUNTERFEIT_TERMS_FILTER_CODE, EXTREME_PRICE_GAP_FILTER_CODE, SELLER_NON_PERSONAL_FILTER_CODE]);
const reasonSchema = z.string().trim().min(1).max(500);
const termsSchema = z.array(z.string().trim().min(1).max(40)).min(1).max(50);
const postSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal(COUNTERFEIT_TERMS_FILTER_CODE), terms: termsSchema, changeReason: reasonSchema, sourceType: z.enum(["manual", "ai-assisted"]).default("manual") }),
  z.object({ code: z.literal(EXTREME_PRICE_GAP_FILTER_CODE), priceRatioBelow: z.number().min(0.01).max(0.99), changeReason: reasonSchema, sourceType: z.enum(["manual", "ai-assisted"]).default("manual") }),
]);
const patchSchema = z.object({ code: codeSchema, enabled: z.boolean(), changeReason: reasonSchema });

const titles: Record<z.infer<typeof codeSchema>, string> = {
  [COUNTERFEIT_TERMS_FILTER_CODE]: "高仿词前置过滤",
  [EXTREME_PRICE_GAP_FILTER_CODE]: "价格严重异常前置过滤",
  [SELLER_NON_PERSONAL_FILTER_CODE]: "疑似非个人卖家判定阈值",
};

function defaultConditions(code: z.infer<typeof codeSchema>) {
  if (code === COUNTERFEIT_TERMS_FILTER_CODE) return { terms: DEFAULT_PRE_FILTER_CONFIGS.counterfeitTerms };
  if (code === EXTREME_PRICE_GAP_FILTER_CODE) return { priceRatioBelow: DEFAULT_PRE_FILTER_CONFIGS.extremePriceRatio };
  return DEFAULT_SELLER_RULE_THRESHOLDS;
}

async function saveVersion(code: z.infer<typeof codeSchema>, conditions: unknown, enabled: boolean | undefined, reason: string, sourceType: "manual" | "ai-assisted" = "manual") {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(ruleDefinitions).where(eq(ruleDefinitions.code, code)).limit(1).for("update");
    const version = (current?.currentVersion ?? 0) + 1;
    const nextEnabled = enabled ?? current?.enabled ?? true;
    let ruleId = current?.id;
    if (current) {
      await tx.update(ruleDefinitions).set({ enabled: nextEnabled, currentVersion: version, updatedAt: new Date() }).where(eq(ruleDefinitions.id, current.id));
    } else {
      const [created] = await tx.insert(ruleDefinitions).values({ code, title: titles[code], category: code === SELLER_NON_PERSONAL_FILTER_CODE ? "seller" : "listing", enabled: nextEnabled, currentVersion: version }).returning({ id: ruleDefinitions.id });
      ruleId = created.id;
    }
    await tx.insert(ruleVersions).values({ ruleId: ruleId!, version, conditions, scoreImpact: 0, explanationTemplate: titles[code], changeReason: reason, sourceType, approvedBy: "local-user" });
    return { code, version, conditions, enabled: nextEnabled, changeReason: reason };
  });
}

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  try {
    const payload = postSchema.parse(await request.json().catch(() => null));
    const conditions = payload.code === COUNTERFEIT_TERMS_FILTER_CODE
      ? { terms: [...new Set(payload.terms)] }
      : { priceRatioBelow: payload.priceRatioBelow };
    return Response.json({ ok: true, rule: await saveVersion(payload.code, conditions, undefined, payload.changeReason, payload.sourceType) });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "规则内容不正确。" }, { status: 400 });
    return Response.json({ error: "规则保存失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  try {
    const payload = patchSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const [definition] = await db.select().from(ruleDefinitions).where(eq(ruleDefinitions.code, payload.code)).limit(1);
    const [saved] = definition ? await db.select({ conditions: ruleVersions.conditions }).from(ruleVersions)
      .where(eq(ruleVersions.ruleId, definition.id)).orderBy(desc(ruleVersions.version)).limit(1) : [];
    const conditions = saved?.conditions ?? defaultConditions(payload.code);
    return Response.json({ ok: true, rule: await saveVersion(payload.code, conditions, payload.enabled, payload.changeReason) });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "规则内容不正确。" }, { status: 400 });
    return Response.json({ error: "规则状态更新失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}
