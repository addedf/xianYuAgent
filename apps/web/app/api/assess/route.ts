import { z } from "zod";
import { buildRuleFacts } from "@/src/domain/facts";
import { finalizeAssessment, filteredAssessment, pendingAssessment } from "@/src/domain/finalize";
import { runPreFilters } from "@/src/domain/pre-filters";
import { selectKnowledge } from "@/src/domain/knowledge-context";
import { adminApiError } from "@/src/server/auth/admin-request";
import { evaluateListing } from "@/src/server/evaluators/typesafe";
import { getServerEnv } from "@/src/server/env";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";
import { loadPreFilterSettings } from "@/src/server/pre-filter-settings";
import { loadActiveKnowledgeEntries } from "@/src/server/knowledge-injection";

const listingSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().min(1),
  platform: z.enum(["xianyu", "demo"]),
  category: z.enum(["watch", "bag", "jewelry", "other"]),
  brand: z.string().min(1),
  model: z.string().optional(),
  title: z.string().min(1),
  description: z.string(),
  price: z.number().nonnegative(),
  marketReferencePrice: z.number().positive().optional(),
  region: z.string().min(1),
  distanceKm: z.number().nonnegative().optional(),
  publishedAt: z.iso.datetime({ offset: true }),
  firstSeenAt: z.iso.datetime({ offset: true }),
  imageUrls: z.array(z.url()),
  duplicateImageCount: z.number().int().nonnegative(),
  hasSerialDetail: z.boolean(),
  hasPurchaseProof: z.boolean(),
  hasAccessoryDescription: z.boolean(),
  monitorKeywords: z.array(z.string().min(1)).min(1),
  sourceUrl: z.url().optional(),
  seller: z.object({
    externalId: z.string().min(1),
    displayName: z.string(),
    region: z.string(),
    activeListingCount: z.number().int().nonnegative(),
    sameCategoryRatio: z.number().min(0).max(1),
    sameCategoryCount: z.number().int().nonnegative().optional(),
    signalScope: z.enum(["observed-listings", "complete-profile", "nickname-only"]).optional(),
    templateSimilarity: z.number().min(0).max(1),
    hasPersonalStorySignals: z.boolean(),
    hasNaturalSceneSignals: z.boolean(),
    accountAgeDays: z.number().int().nonnegative().optional(),
  }),
  includeModel: z.boolean().optional().default(false),
});

// 试算端点：只做前置过滤与事实构建，不落库。includeModel 时才调用 JEV 收敛出完整评估；
// JEV 不可用返回 503 并说明保持待评分状态，不再提供规则兜底评分。
export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  const payload = listingSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return Response.json({ error: "商品数据格式不正确。", issues: payload.error.issues }, { status: 400 });
  }

  const { includeModel, ...listing } = payload.data;
  const facts = buildRuleFacts(listing);
  const [sellerRuleSettings, preFilterSettings, activeKnowledge] = await Promise.all([loadSellerRuleSettings(), loadPreFilterSettings(), loadActiveKnowledgeEntries()]);
  const sellerThresholds = sellerRuleSettings.enabled === false ? null : sellerRuleSettings.thresholds;
  const filterHit = runPreFilters(listing, { ...preFilterSettings.configs, sellerThresholds });
  if (filterHit) {
    return Response.json({
      facts,
      filters: filterHit,
      ...(includeModel ? { assessment: filteredAssessment(listing, filterHit), jevEvaluated: false } : {}),
    });
  }
  if (!includeModel) return Response.json({ facts, filters: null });
  if (listing.platform === "demo") {
    return Response.json({ facts, filters: null, assessment: pendingAssessment(listing), jevEvaluated: false });
  }

  const selectedKnowledge = selectKnowledge(activeKnowledge, listing);
  const evaluation = await evaluateListing(listing, facts, { mode: "manual", sellerRuleThresholds: sellerThresholds, knowledge: selectedKnowledge });
  if (!evaluation) {
    return Response.json({ error: "JEV 不可用或评分失败，本次未保存评分；线索保持待评分状态。", facts, filters: null }, { status: 503 });
  }
  const assessment = finalizeAssessment(listing, facts, evaluation, { confidenceThreshold: getServerEnv().TYPESAFE_CONFIDENCE_THRESHOLD });
  return Response.json({ facts, filters: null, assessment, jevEvaluated: true });
}
