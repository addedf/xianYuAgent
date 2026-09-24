import { createHash } from "node:crypto";
import postgres from "postgres";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { MarketplaceListing, ListingAssessment } from "@/src/domain/listing";
import { fuseAssessment, withModelUnavailable } from "@/src/domain/fusion";
import { assessListing, RULESET_VERSION } from "@/src/domain/scoring";
import { getDatabase } from "@/src/server/db/client";
import { getServerEnv } from "@/src/server/env";
import { evaluateListing } from "@/src/server/evaluators/typesafe";
import { QUESTIONS_VERSION } from "@/src/server/evaluators/typesafe/questions";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";
import { assessments, marketplaceListings, sellers } from "@/src/server/db/schema";
import { parseSourceProduct, type SourceProduct, xianyuProductExternalId } from "./xianyu-spider";

function fingerprint(listing: MarketplaceListing): string {
  return createHash("sha256").update(JSON.stringify({
    category: listing.category,
    brand: listing.brand,
    model: listing.model ?? null,
    title: listing.title,
    price: listing.price,
    description: listing.description,
    region: listing.region,
    publishedAt: listing.publishedAt,
    imageUrls: listing.imageUrls.map((url) => url.split(/[?#]/, 1)[0]).sort(),
    monitorKeywords: [...listing.monitorKeywords].sort(),
    marketReferencePrice: listing.marketReferencePrice ?? null,
    duplicateImageCount: listing.duplicateImageCount,
    sellerSignals: {
      templateSimilarity: listing.seller.templateSimilarity,
      hasPersonalStorySignals: listing.seller.hasPersonalStorySignals,
      hasNaturalSceneSignals: listing.seller.hasNaturalSceneSignals,
      accountAgeDays: listing.seller.accountAgeDays ?? null,
    },
  })).digest("hex").slice(0, 32);
}

function legacyFingerprints(listing: MarketplaceListing): string[] {
  const previousContentHash = [listing.title, listing.price, listing.description, listing.region, listing.imageUrls.length].join("|");
  const originalImportHash = [listing.title, listing.price, listing.region].join("|");
  return [previousContentHash, originalImportHash].map((value) => createHash("sha256").update(value).digest("hex").slice(0, 32));
}

type SellerSignals = Pick<MarketplaceListing["seller"], "activeListingCount" | "sameCategoryRatio" | "sameCategoryCount">;

function readSellerSignals(value: unknown): SellerSignals | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const signals = (value as Record<string, unknown>).sellerSignals;
  if (signals === null || typeof signals !== "object" || Array.isArray(signals)) return null;
  const record = signals as Record<string, unknown>;
  if (typeof record.activeListingCount !== "number" || !Number.isFinite(record.activeListingCount)
    || typeof record.sameCategoryRatio !== "number" || !Number.isFinite(record.sameCategoryRatio)) return null;
  return {
    activeListingCount: record.activeListingCount,
    sameCategoryRatio: record.sameCategoryRatio,
    sameCategoryCount: typeof record.sameCategoryCount === "number" && Number.isFinite(record.sameCategoryCount)
      ? record.sameCategoryCount
      : Math.round(record.activeListingCount * record.sameCategoryRatio),
  };
}

async function loadSellerSignals(db: ReturnType<typeof getDatabase>["db"], sellerId: string, category: MarketplaceListing["category"]): Promise<SellerSignals> {
  const rows = await db.select({ category: marketplaceListings.category, status: marketplaceListings.status })
    .from(marketplaceListings)
    .where(eq(marketplaceListings.sellerId, sellerId));
  const activeRows = rows.filter((row) => row.status === "active");
  const denominator = Math.max(activeRows.length, 1);
  return {
    activeListingCount: activeRows.length,
    sameCategoryRatio: activeRows.filter((row) => row.category === category).length / denominator,
    sameCategoryCount: activeRows.filter((row) => row.category === category).length,
  };
}

export async function loadSourceProducts(ids: number[], databaseUrl: string): Promise<SourceProduct[]> {
  if (ids.length === 0) return [];
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 5, prepare: false });
  try {
    let rows;
    try {
      rows = await client`select id, title, price, area, seller, link, image_url, image_urls, publish_time from xianyu_products where id in ${client(ids)}`;
    } catch {
      rows = await client`select id, title, price, area, seller, link, image_url, publish_time from xianyu_products where id in ${client(ids)}`;
    }
    return rows.map(parseSourceProduct);
  } catch {
    throw new Error("无法读取采集器的 xianyu_products 表，请确认采集器与 Web 使用同一本机 PostgreSQL 数据库。");
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

function assessmentValues(assessment: ListingAssessment, inputFingerprint: string) {
  return {
    rulesetVersion: assessment.rulesetVersion,
    modelVersion: assessment.modelVersion,
    modelConfidence: assessment.modelConfidence,
    modelEvaluation: assessment.modelEvaluation,
    inputFingerprint,
    riskLevel: assessment.riskLevel,
    recommendedAction: assessment.recommendedAction,
    totalOpportunity: assessment.scores.totalOpportunity,
    scores: assessment.scores,
    evidence: assessment.evidence,
    missingInformation: assessment.missingInformation,
    summary: assessment.summary,
    evaluatedAt: new Date(assessment.evaluatedAt),
  };
}

export async function saveListings(listings: MarketplaceListing[], sourceProducts: SourceProduct[]): Promise<number> {
  const { db } = getDatabase();
  const env = getServerEnv();
  const sellerRuleSettings = await loadSellerRuleSettings();
  const jevConfigured = env.TYPESAFE_ENABLED === "true";
  let imported = 0;
  const seenExternalIds = new Set(listings.map((listing) => listing.externalId));
  const currentKeywords = new Set(listings.flatMap((listing) => listing.monitorKeywords));
  const workItems: Array<{
    id: string;
    sellerId: string;
    listing: MarketplaceListing;
    priorSignals: SellerSignals | null;
    rawPayload: Record<string, unknown>;
  }> = [];

  for (const listing of listings) {
    const sourceProduct = sourceProducts.find((product) => xianyuProductExternalId(product.link, product.id) === listing.externalId);
    const [seller] = await db.insert(sellers).values({ platform: "xianyu", externalId: listing.seller.externalId, displayName: listing.seller.displayName, region: listing.seller.region, profileSnapshot: { source: "xianyu-spider", completeness: "nickname-only" } }).onConflictDoUpdate({ target: [sellers.platform, sellers.externalId], set: { displayName: listing.seller.displayName, region: listing.seller.region, lastSeenAt: new Date(), updatedAt: new Date() } }).returning({ id: sellers.id });
    const nextFingerprint = fingerprint(listing);
    const [existing] = await db.select({ id: marketplaceListings.id, contentFingerprint: marketplaceListings.contentFingerprint, rawPayload: marketplaceListings.rawPayload }).from(marketplaceListings).where(and(eq(marketplaceListings.platform, "xianyu"), eq(marketplaceListings.externalId, listing.externalId))).limit(1);
    const priorSignals = existing ? readSellerSignals(existing.rawPayload) : null;
    const rawPayload = {
      collector: "xianyu-spider-compatible",
      sourceProductId: sourceProduct?.id,
      sellerName: listing.seller.displayName,
      monitorKeywords: listing.monitorKeywords,
      ...(priorSignals ? { sellerSignals: priorSignals } : {}),
    };
    const listingValues = {
      sellerId: seller.id,
      category: listing.category,
      brand: listing.brand,
      model: listing.model,
      title: listing.title,
      description: listing.description,
      price: String(listing.price),
      region: listing.region,
      publishedAt: new Date(listing.publishedAt),
      sourceUrl: listing.sourceUrl,
      imageRefs: listing.imageUrls,
      rawPayload,
      contentFingerprint: nextFingerprint,
      lastSeenAt: new Date(),
      absentScanCount: 0,
      status: "active",
      updatedAt: new Date(),
    };

    if (!existing) {
      const [inserted] = await db.insert(marketplaceListings).values({ platform: "xianyu", externalId: listing.externalId, firstSeenAt: new Date(listing.firstSeenAt), ...listingValues }).returning({ id: marketplaceListings.id });
      workItems.push({ id: inserted.id, sellerId: seller.id, listing, priorSignals: null, rawPayload });
      imported += 1;
      continue;
    }

    const changed = existing.contentFingerprint !== nextFingerprint && !legacyFingerprints(listing).includes(existing.contentFingerprint ?? "");
    await db.update(marketplaceListings).set(listingValues).where(eq(marketplaceListings.id, existing.id));
    workItems.push({ id: existing.id, sellerId: seller.id, listing, priorSignals, rawPayload });
    if (changed) imported += 1;
  }

  // 先写入本批次全部商品，再计算卖家画像，避免同一卖家的前几条记录看不到后续商品。
  const sellerSignalsCache = new Map<string, SellerSignals>();
  const latestAssessments = new Map<string, { inputFingerprint: string | null; modelVersion: string | null }>();
  if (workItems.length > 0) {
    const persistedAssessments = await db.select({ listingId: assessments.listingId, inputFingerprint: assessments.inputFingerprint, modelVersion: assessments.modelVersion }).from(assessments).where(inArray(assessments.listingId, workItems.map((item) => item.id))).orderBy(desc(assessments.evaluatedAt));
    for (const row of persistedAssessments) {
      if (!latestAssessments.has(row.listingId)) latestAssessments.set(row.listingId, { inputFingerprint: row.inputFingerprint, modelVersion: row.modelVersion });
    }
  }
  for (const item of workItems) {
    const cacheKey = `${item.sellerId}:${item.listing.category}`;
    const signals = sellerSignalsCache.get(cacheKey) ?? await loadSellerSignals(db, item.sellerId, item.listing.category);
    sellerSignalsCache.set(cacheKey, signals);
    await db.update(sellers).set({
      profileSnapshot: {
        source: "xianyu-spider",
        completeness: "observed-listings",
        activeListingCount: signals.activeListingCount,
        sameCategoryRatio: signals.sameCategoryRatio,
        sameCategoryCount: signals.sameCategoryCount,
        signalScope: "当前已入库的活跃商品，不等同于完整主页统计",
      },
      updatedAt: new Date(),
    }).where(eq(sellers.id, item.sellerId));

    await db.update(marketplaceListings).set({ rawPayload: { ...item.rawPayload, sellerSignals: signals } }).where(eq(marketplaceListings.id, item.id));

    const enrichedListing = {
      ...item.listing,
      id: item.id,
      seller: { ...item.listing.seller, ...signals, signalScope: "observed-listings" as const },
    };
    const assessmentInputFingerprint = createHash("sha256").update(JSON.stringify({
      content: fingerprint(enrichedListing), sellerSignals: signals,
      sellerIdentityScope: enrichedListing.seller.identityScope ?? "unknown",
      sellerSignalScope: enrichedListing.seller.signalScope ?? "nickname-only",
      completedSaleCount: enrichedListing.seller.completedSaleCount ?? null,
      completedSaleCountVerified: enrichedListing.seller.completedSaleCountVerified === true,
      sellerRuleThresholds: sellerRuleSettings.thresholds,
      rulesetVersion: RULESET_VERSION, questionsVersion: QUESTIONS_VERSION,
    })).digest("hex").slice(0, 32);
    const latestAssessment = latestAssessments.get(item.id);
    if (latestAssessment?.inputFingerprint === assessmentInputFingerprint && (!jevConfigured || latestAssessment.modelVersion !== null)) continue;

    const ruleAssessment = assessListing(enrichedListing, new Date(), sellerRuleSettings.thresholds);
    const jev = await evaluateListing(enrichedListing, ruleAssessment, { sellerRuleThresholds: sellerRuleSettings.thresholds });
    const finalAssessment = jev ? fuseAssessment(ruleAssessment, jev, env.TYPESAFE_CONFIDENCE_THRESHOLD, enrichedListing.seller, sellerRuleSettings.thresholds) : (jevConfigured ? withModelUnavailable(ruleAssessment) : ruleAssessment);
    await db.insert(assessments).values({ listingId: item.id, ...assessmentValues(finalAssessment, assessmentInputFingerprint) }).onConflictDoNothing({ target: [assessments.listingId, assessments.inputFingerprint] });
  }

  if (seenExternalIds.size > 0) {
    const activeListings = await db.select({ id: marketplaceListings.id, externalId: marketplaceListings.externalId, absentScanCount: marketplaceListings.absentScanCount, rawPayload: marketplaceListings.rawPayload }).from(marketplaceListings).where(and(eq(marketplaceListings.platform, "xianyu"), eq(marketplaceListings.status, "active")));
    for (const row of activeListings) {
      if (seenExternalIds.has(row.externalId)) continue;
      const payload = row.rawPayload && typeof row.rawPayload === "object" && !Array.isArray(row.rawPayload) ? row.rawPayload as { monitorKeywords?: unknown } : {};
      const previousKeywords = Array.isArray(payload.monitorKeywords) ? payload.monitorKeywords.filter((value): value is string => typeof value === "string") : [];
      // A keyword search is only a complete scan for its own monitor scope. Never mark a
      // listing from another keyword/task as absent because this scan did not include it.
      if (currentKeywords.size > 0 && previousKeywords.length > 0 && !previousKeywords.some((keyword) => currentKeywords.has(keyword))) continue;
      const absentScanCount = row.absentScanCount + 1;
      await db.update(marketplaceListings).set({ absentScanCount, status: absentScanCount >= 3 ? "possibly_sold" : "active", updatedAt: new Date() }).where(eq(marketplaceListings.id, row.id));
    }
  }
  return imported;
}
