import { createHash } from "node:crypto";
import { z } from "zod";
import { fuseAssessment, withModelUnavailable } from "@/src/domain/fusion";
import { assessListing } from "@/src/domain/scoring";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { assessments } from "@/src/server/db/schema";
import { evaluateListing } from "@/src/server/evaluators/typesafe";
import { QUESTIONS_VERSION } from "@/src/server/evaluators/typesafe/questions";
import { getServerEnv } from "@/src/server/env";
import { loadLatestAssessedListings } from "@/src/server/listings";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";

const payloadSchema = z.object({ listingId: z.uuid() });

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  const payload = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return Response.json({ error: "商品编号格式不正确。" }, { status: 400 });

  try {
    const [item] = await loadLatestAssessedListings(1, payload.data.listingId, true);
    if (!item) return Response.json({ error: "没有找到这条入库商品。" }, { status: 404 });

    const sellerRuleThresholds = (await loadSellerRuleSettings()).thresholds;
    const ruleAssessment = assessListing(item.listing, new Date(), sellerRuleThresholds);
    const evaluation = await evaluateListing(item.listing, ruleAssessment, { mode: "manual", sellerRuleThresholds });
    const env = getServerEnv();
    const assessment = evaluation
      ? fuseAssessment(ruleAssessment, evaluation, env.TYPESAFE_CONFIDENCE_THRESHOLD, item.listing.seller, sellerRuleThresholds)
      : env.TYPESAFE_ENABLED === "true" ? withModelUnavailable(ruleAssessment) : ruleAssessment;
    const inputFingerprint = createHash("sha256").update(JSON.stringify({
      listing: {
        externalId: item.listing.externalId,
        category: item.listing.category,
        brand: item.listing.brand,
        model: item.listing.model ?? null,
        title: item.listing.title,
        description: item.listing.description,
        price: item.listing.price,
        imageUrls: item.listing.imageUrls.map((url) => url.split(/[?#]/, 1)[0]).sort(),
      },
      seller: {
        activeListingCount: item.listing.seller.activeListingCount,
        sameCategoryCount: item.listing.seller.sameCategoryCount,
        sameCategoryRatio: item.listing.seller.sameCategoryRatio,
        completedSaleCount: item.listing.seller.completedSaleCount ?? null,
        completedSaleCountVerified: item.listing.seller.completedSaleCountVerified === true,
        identityScope: item.listing.seller.identityScope ?? "unknown",
        signalScope: item.listing.seller.signalScope ?? "nickname-only",
      },
      sellerRuleThresholds,
      rulesetVersion: assessment.rulesetVersion,
      questionsVersion: QUESTIONS_VERSION,
    })).digest("hex").slice(0, 32);
    const { db } = getDatabase();
    const values = {
      listingId: item.listing.id,
      rulesetVersion: assessment.rulesetVersion,
      modelVersion: assessment.modelVersion ?? null,
      modelConfidence: assessment.modelConfidence ?? null,
      modelEvaluation: assessment.modelEvaluation ?? null,
      inputFingerprint,
      riskLevel: assessment.riskLevel,
      recommendedAction: assessment.recommendedAction,
      totalOpportunity: assessment.scores.totalOpportunity,
      scores: assessment.scores,
      evidence: assessment.evidence,
      missingInformation: assessment.missingInformation,
      summary: assessment.summary,
      evaluatedAt: new Date(assessment.evaluatedAt),
      updatedAt: new Date(),
    };
    await db.insert(assessments).values(values).onConflictDoUpdate({
      target: [assessments.listingId, assessments.inputFingerprint],
      set: values,
    });

    return Response.json({ ok: true, jevEvaluated: evaluation !== null, totalOpportunity: assessment.scores.totalOpportunity });
  } catch {
    return Response.json({ error: "重新评分失败，请检查数据库和 JEV 配置后重试。" }, { status: 503 });
  }
}
