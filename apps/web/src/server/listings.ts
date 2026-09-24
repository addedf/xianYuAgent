import { desc, eq, inArray } from "drizzle-orm";
import type { AssessmentEvidence, AssessmentScores, Category, ListingAssessment, MarketplaceListing, RecommendedAction, RiskLevel } from "@/src/domain/listing";
import { assessListing } from "@/src/domain/scoring";
import { getDatabase } from "@/src/server/db/client";
import { assessments, marketplaceListings, sellers } from "@/src/server/db/schema";

const categories = new Set<Category>(["watch", "bag", "jewelry"]);
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
function assessmentFromRow(row: typeof assessments.$inferSelect): ListingAssessment {
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
  return {
    assessmentId: row.id,
    listingId: row.listingId,
    riskLevel,
    recommendedAction,
    scores,
    evidence,
    missingInformation: asStringArray(row.missingInformation),
    suggestedQuestions: asStringArray(row.missingInformation).slice(0, 3).map((item) => `方便补充${item}吗？`),
    summary: row.summary,
    evaluatedAt: row.evaluatedAt.toISOString(),
    rulesetVersion: row.rulesetVersion,
    modelConfidence: row.modelConfidence ?? undefined,
    modelVersion: row.modelVersion ?? undefined,
    modelEvaluation: row.modelEvaluation && typeof row.modelEvaluation === "object" ? asRecord(row.modelEvaluation) : undefined,
    modelReviewRequired: row.modelConfidence !== null && row.modelConfidence < 55,
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
    const category = categories.has(row.listing.category as Category) ? row.listing.category as Category : "bag";
    const sellerSignalSnapshot = asRecord(rawPayload.sellerSignals);
    const freshSignals = row.listing.sellerId ? sellerSignals.get(row.listing.sellerId) : undefined;
    const hasCompleteProfile = profileSnapshot.completeness === "complete-profile";
    const activeListingCount = hasCompleteProfile
      ? asNumber(profileSnapshot.activeListingCount, freshSignals?.activeListingCount ?? asNumber(sellerSignalSnapshot.activeListingCount))
      : freshSignals?.activeListingCount ?? asNumber(sellerSignalSnapshot.activeListingCount, asNumber(profileSnapshot.activeListingCount));
    const sameCategoryCount = hasCompleteProfile
      ? asNumber(profileSnapshot.sameCategoryCount, freshSignals?.categoryCounts.get(category) ?? asNumber(sellerSignalSnapshot.sameCategoryCount))
      : freshSignals?.categoryCounts.get(category) ?? asNumber(sellerSignalSnapshot.sameCategoryCount);
    const sameCategoryRatio = hasCompleteProfile
      ? asNumber(profileSnapshot.sameCategoryRatio, activeListingCount > 0 ? sameCategoryCount / activeListingCount : 0)
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
        ...(profileSnapshot.completedSaleCountVerified === true && typeof profileSnapshot.completedSaleCount === "number" && Number.isSafeInteger(profileSnapshot.completedSaleCount) && profileSnapshot.completedSaleCount >= 0
          ? { completedSaleCount: profileSnapshot.completedSaleCount, completedSaleCountVerified: true }
          : {}),
        identityScope: row.sellerExternalId?.startsWith("nickname-") ? "nickname-region" as const : "unknown" as const,
        signalScope,
        templateSimilarity: 0,
        hasPersonalStorySignals: false,
        hasNaturalSceneSignals: false,
      },
    };
    return [{ listing, assessment: assessmentRow ? assessmentFromRow(assessmentRow) : assessListing(listing) }];
  });
  return assessed.sort((a, b) => b.assessment.scores.totalOpportunity - a.assessment.scores.totalOpportunity
    || Date.parse(b.listing.firstSeenAt) - Date.parse(a.listing.firstSeenAt));
}
