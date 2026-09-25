import { desc, eq, inArray } from "drizzle-orm";
import type { AssessmentEvidence, AssessmentScores, Category, ListingAssessment, MarketplaceListing, RecommendedAction, RiskLevel } from "@/src/domain/listing";
import { suggestedQuestionsFromMissing } from "@/src/domain/facts";
import { selectKnowledge } from "@/src/domain/knowledge-context";
import { pendingAssessment } from "@/src/domain/finalize";
import { getDatabase } from "@/src/server/db/client";
import { assessments, marketplaceListings, sellers } from "@/src/server/db/schema";
import { getServerEnv } from "@/src/server/env";
import { loadActiveKnowledgeEntries } from "@/src/server/knowledge-injection";

const categories = new Set<Category>(["watch", "bag", "jewelry", "other"]);
const riskLevels = new Set<RiskLevel>(["low", "insufficient", "medium", "high"]);
const actions = new Set<RecommendedAction>(["notify", "review", "archive", "skip"]);

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function asNumberRecord(value: unknown): Record<string, number> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0) result[key] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
function assessmentFromRow(row: typeof assessments.$inferSelect, confidenceThreshold: number): ListingAssessment {
  const score = asRecord(row.scores);
  const evidence = Array.isArray(row.evidence) ? row.evidence.filter((item): item is AssessmentEvidence => {
    const value = asRecord(item);
    return typeof value.code === "string" && typeof value.label === "string" && typeof value.detail === "string" && typeof value.source === "string";
  }) : [];
  const riskLevel = riskLevels.has(row.riskLevel as RiskLevel) ? row.riskLevel as RiskLevel : "insufficient";
  const recommendedAction = actions.has(row.recommendedAction as RecommendedAction) ? row.recommendedAction as RecommendedAction : "review";
  const scores: AssessmentScores = {
    categoryMatch: asNumber(score.categoryMatch),
    personalSeller: asNumber(score.personalSeller),
    authenticityRisk: asNumber(score.authenticityRisk),
    informationCompleteness: asNumber(score.informationCompleteness),
    profitOpportunity: asNumber(score.profitOpportunity),
    recency: asNumber(score.recency),
    totalOpportunity: row.totalOpportunity,
  };
  const missingInformation = asStringArray(row.missingInformation);
  return {
    assessmentId: row.id,
    listingId: row.listingId,
    riskLevel,
    recommendedAction,
    scores,
    evidence,
    missingInformation,
    suggestedQuestions: suggestedQuestionsFromMissing(missingInformation),
    summary: row.summary,
    evaluatedAt: row.evaluatedAt.toISOString(),
    rulesetVersion: row.rulesetVersion,
    modelConfidence: row.modelConfidence ?? undefined,
    modelVersion: row.modelVersion ?? undefined,
    modelEvaluation: row.modelEvaluation && typeof row.modelEvaluation === "object" ? asRecord(row.modelEvaluation) : undefined,
    modelReviewRequired: row.modelConfidence !== null && row.modelConfidence < confidenceThreshold,
    filterCode: row.filterCode ?? undefined,
    knowledgeUsed: asStringArray(row.knowledgeUsed),
    priceReferenceUsed: row.priceReferenceUsed && typeof row.priceReferenceUsed === "object" ? asRecord(row.priceReferenceUsed) : undefined,
  };
}

export async function loadLatestAssessedListings(limit = 80, listingId?: string, includeUnassessed = false) {
  const { db } = getDatabase();
  const rows = await db.select({ listing: marketplaceListings, sellerExternalId: sellers.externalId, sellerDisplayName: sellers.displayName, sellerRegion: sellers.region, sellerProfileSnapshot: sellers.profileSnapshot }).from(marketplaceListings).leftJoin(sellers, eq(marketplaceListings.sellerId, sellers.id)).where(listingId ? eq(marketplaceListings.id, listingId) : undefined).orderBy(desc(marketplaceListings.firstSeenAt)).limit(Math.min(Math.max(limit, 1), 200));
  if (rows.length === 0) return [];
  const sellerIds = [...new Set(rows.map((row) => row.listing.sellerId).filter((id): id is string => id !== null))];
  const observedSellerListings = sellerIds.length > 0
    ? await db.select({ sellerId: marketplaceListings.sellerId, category: marketplaceListings.category, status: marketplaceListings.status })
      .from(marketplaceListings)
      .where(inArray(marketplaceListings.sellerId, sellerIds))
    : [];
  const sellerSignals = new Map<string, { activeListingCount: number; categoryCounts: Map<Category, number> }>();
  for (const sellerId of sellerIds) sellerSignals.set(sellerId, { activeListingCount: 0, categoryCounts: new Map<Category, number>() });
  for (const row of observedSellerListings) {
    if (row.sellerId === null || row.status !== "active") continue;
    const current = sellerSignals.get(row.sellerId) ?? { activeListingCount: 0, categoryCounts: new Map<Category, number>() };
    current.activeListingCount += 1;
    const category = categories.has(row.category as Category) ? row.category as Category : null;
    if (category) current.categoryCounts.set(category, (current.categoryCounts.get(category) ?? 0) + 1);
    sellerSignals.set(row.sellerId, current);
  }
  const listingIds = rows.map((row) => row.listing.id);
  const assessmentRows = await db.select({ assessment: assessments }).from(assessments).where(inArray(assessments.listingId, listingIds)).orderBy(desc(assessments.evaluatedAt));
  const latest = new Map<string, typeof assessments.$inferSelect>();
  for (const row of assessmentRows) if (!latest.has(row.assessment.listingId)) latest.set(row.assessment.listingId, row.assessment);

  const assessed = rows.flatMap((row) => {
    const assessmentRow = latest.get(row.listing.id);
    if (!assessmentRow && !includeUnassessed) return [];
    const rawPayload = asRecord(row.listing.rawPayload);
    const profileSnapshot = asRecord(row.sellerProfileSnapshot);
    const category = categories.has(row.listing.category as Category) ? row.listing.category as Category : "other";
    const sellerSignalSnapshot = asRecord(rawPayload.sellerSignals);
    const freshSignals = row.listing.sellerId ? sellerSignals.get(row.listing.sellerId) : undefined;
    const hasCompleteProfile = profileSnapshot.completeness === "complete-profile";
    const activeListingCount = freshSignals?.activeListingCount
      ?? asNumber(sellerSignalSnapshot.activeListingCount, asNumber(profileSnapshot.activeListingCount));
    const sameCategoryCount = category === "other" ? 0
      : freshSignals?.categoryCounts.get(category) ?? asNumber(sellerSignalSnapshot.sameCategoryCount, asNumber(profileSnapshot.sameCategoryCount));
    const sameCategoryRatio = category === "other" ? 0
      : freshSignals
        ? (freshSignals.activeListingCount > 0 ? sameCategoryCount / freshSignals.activeListingCount : 0)
        : asNumber(sellerSignalSnapshot.sameCategoryRatio, asNumber(profileSnapshot.sameCategoryRatio));
    const signalScope = hasCompleteProfile
      ? "complete-profile" as const
      : freshSignals || sellerSignalSnapshot.activeListingCount !== undefined || profileSnapshot.completeness === "observed-listings"
        ? "observed-listings" as const
        : "nickname-only" as const;
    const listing: MarketplaceListing = {
      id: row.listing.id,
      externalId: row.listing.externalId,
      platform: "xianyu",
      category,
      brand: row.listing.brand || "待识别品牌",
      model: row.listing.model || undefined,
      title: row.listing.title,
      description: row.listing.description,
      price: Number(row.listing.price),
      ...(row.listing.marketReferencePrice !== null && row.listing.marketReferenceId !== null && row.listing.marketReferenceVersion !== null && row.listing.marketReferenceExpiresAt && row.listing.marketReferenceExpiresAt.getTime() > Date.now()
        ? { marketReferencePrice: Number(row.listing.marketReferencePrice), marketReferenceId: row.listing.marketReferenceId, marketReferenceVersion: row.listing.marketReferenceVersion } : {}),
      region: row.listing.region || "地区未知",
      publishedAt: row.listing.publishedAt?.toISOString() ?? new Date(0).toISOString(),
      firstSeenAt: row.listing.firstSeenAt.toISOString(),
      imageUrls: asStringArray(row.listing.imageRefs),
      duplicateImageCount: 0,
      hasSerialDetail: false,
      hasPurchaseProof: false,
      hasAccessoryDescription: false,
      monitorKeywords: asStringArray(rawPayload.monitorKeywords).length > 0 ? asStringArray(rawPayload.monitorKeywords) : [row.listing.brand || row.listing.title],
      sourceUrl: row.listing.sourceUrl || undefined,
      status: row.listing.status === "possibly_sold" ? "possibly_sold" : "active",
      lastSeenAt: row.listing.lastSeenAt.toISOString(),
      absentScanCount: row.listing.absentScanCount,
      seller: {
        externalId: row.sellerExternalId || `unknown-${row.listing.externalId}`,
        displayName: row.sellerDisplayName || (typeof rawPayload.sellerName === "string" ? rawPayload.sellerName : "匿名卖家"),
        region: row.sellerRegion || row.listing.region || "地区未知",
        activeListingCount,
        sameCategoryRatio,
        sameCategoryCount,
        observedCategoryCounts: freshSignals ? Object.fromEntries(freshSignals.categoryCounts) : undefined,
        profileCategoryMix: hasCompleteProfile ? asNumberRecord(profileSnapshot.categoryMix) : undefined,
        ...(profileSnapshot.completedSaleCountVerified === true && typeof profileSnapshot.completedSaleCount === "number" && Number.isSafeInteger(profileSnapshot.completedSaleCount) && profileSnapshot.completedSaleCount >= 0
          ? { completedSaleCount: profileSnapshot.completedSaleCount, completedSaleCountVerified: true }
          : {}),
        ...(hasCompleteProfile && typeof profileSnapshot.onSaleCount === "number" && Number.isSafeInteger(profileSnapshot.onSaleCount) && profileSnapshot.onSaleCount >= 0
          ? { onSaleCount: profileSnapshot.onSaleCount }
          : {}),
        ...(hasCompleteProfile && typeof profileSnapshot.creditLevel === "string" && profileSnapshot.creditLevel.trim()
          ? { creditLevel: profileSnapshot.creditLevel.trim() }
          : {}),
        identityScope: row.sellerExternalId?.startsWith("xianyu-user-")
          ? "stable-platform-id" as const
          : row.sellerExternalId?.startsWith("nickname-") ? "nickname-region" as const : "unknown" as const,
        signalScope,
        templateSimilarity: 0,
        hasPersonalStorySignals: false,
        hasNaturalSceneSignals: false,
      },
    };
    const previousPrice = asRecord(assessmentRow?.priceReferenceUsed);
    const previousPriceVersion = asNumber(previousPrice.version);
    const stalePriceReference = Boolean(assessmentRow) && (previousPriceVersion !== (listing.marketReferenceVersion ?? 0)
      || (listing.marketReferenceId !== undefined && previousPrice.id !== listing.marketReferenceId));
    const assessment = assessmentRow && !stalePriceReference ? assessmentFromRow(assessmentRow, getServerEnv().TYPESAFE_CONFIDENCE_THRESHOLD) : pendingAssessment(listing);
    if (stalePriceReference) {
      assessment.pendingReason = "price-reference-changed";
      assessment.summary = "市场参考价已变更、停用或过期，旧评分暂不作为当前判断；请重新评分。";
      assessment.evidence[0].detail = assessment.summary;
    }
    return [{ listing, assessment }];
  });
  const activeKnowledge = await loadActiveKnowledgeEntries();
  for (const item of assessed) item.assessment.knowledgeQuestions = selectKnowledge(activeKnowledge, item.listing)
    .filter((entry) => entry.entryType === "question").map((entry) => `${entry.title}：${entry.summary}`);
  return assessed.sort((a, b) => b.assessment.scores.totalOpportunity - a.assessment.scores.totalOpportunity
    || Date.parse(b.listing.firstSeenAt) - Date.parse(a.listing.firstSeenAt));
}
