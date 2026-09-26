import { createHash } from "node:crypto";
import postgres from "postgres";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import type { MarketplaceListing } from "@/src/domain/listing";
import type { ListingAssessment } from "@/src/domain/listing";
import { buildRuleFacts } from "@/src/domain/facts";
import { finalizeAssessment, filteredAssessment, RULESET_VERSION } from "@/src/domain/finalize";
import { runPreFilters, type PreFilterConfigs, type PreFilterHit } from "@/src/domain/pre-filters";
import { knowledgeHash, knowledgeUsed, selectKnowledge } from "@/src/domain/knowledge-context";
import { priceReferenceSnapshot } from "@/src/domain/price-reference";
import { sellerIdentityCandidates, weakIdentityKey } from "@/src/domain/seller-identity";
import type { SellerRuleThresholds } from "@/src/domain/seller-rules";
import { getDatabase } from "@/src/server/db/client";
import { getServerEnv } from "@/src/server/env";
import { evaluateListing } from "@/src/server/evaluators/typesafe";
import { QUESTIONS_VERSION } from "@/src/server/evaluators/typesafe/questions";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";
import { loadPreFilterSettings } from "@/src/server/pre-filter-settings";
import { loadActiveKnowledgeEntries } from "@/src/server/knowledge-injection";
import { loadActiveExclusionMap, loadHandlingMap, matchExclusion } from "@/src/server/exclusions";
import { assessments, marketplaceListings, sellers } from "@/src/server/db/schema";
import { legacySellerExternalId, parseDetailSnapshot, parseSellerProfileSnapshot, parseSourceProduct, type SourceProduct, type SellerProfileSnapshot, xianyuProductExternalId } from "./xianyu-spider";

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
    marketReferenceId: listing.marketReferenceId ?? null,
    marketReferenceVersion: listing.marketReferenceVersion ?? null,
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

function sha256Prefix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

// 两个指纹构建器同时供导入管道与手动重评接口使用，保证同一输入落到同一条评估记录。
export function scoredAssessmentFingerprint(listing: MarketplaceListing, sellerRuleThresholds: SellerRuleThresholds | null, selectedKnowledgeHash = ""): string {
  return sha256Prefix(JSON.stringify({
    content: fingerprint(listing),
    sellerSignals: {
      activeListingCount: listing.seller.activeListingCount,
      sameCategoryRatio: listing.seller.sameCategoryRatio,
      sameCategoryCount: listing.seller.sameCategoryCount ?? Math.round(listing.seller.activeListingCount * listing.seller.sameCategoryRatio),
    },
    sellerIdentityScope: listing.seller.identityScope ?? "unknown",
    sellerSignalScope: listing.seller.signalScope ?? "nickname-only",
    completedSaleCount: listing.seller.completedSaleCount ?? null,
    completedSaleCountVerified: listing.seller.completedSaleCountVerified === true,
    sellerRuleThresholds,
    knowledgeHash: selectedKnowledgeHash,
    rulesetVersion: RULESET_VERSION,
    questionsVersion: QUESTIONS_VERSION,
  }));
}

export function filteredAssessmentFingerprint(listing: MarketplaceListing, hit: PreFilterHit, configs: PreFilterConfigs): string {
  return sha256Prefix(JSON.stringify({
    content: fingerprint(listing),
    filter: {
      code: hit.code,
      detail: hit.detail,
      counterfeitTerms: configs.counterfeitTerms ? [...configs.counterfeitTerms].sort() : null,
      extremePriceRatio: configs.extremePriceRatio,
      sellerThresholds: configs.sellerThresholds,
    },
    rulesetVersion: RULESET_VERSION,
  }));
}

type SellerSignals = Pick<MarketplaceListing["seller"], "activeListingCount" | "sameCategoryRatio" | "sameCategoryCount">;

/** profileSnapshot 里由平台主页事实组成的部分，用于在无主页 JOIN 的批次中原样保留。 */
type SellerProfileRecord = {
  completeness?: unknown;
  completedSaleCount?: unknown;
  completedSaleCountVerified?: unknown;
  onSaleCount?: unknown;
  creditLevel?: unknown;
  categoryMix?: unknown;
  profileFetchedAt?: unknown;
};

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
    // “其他”混合了不同商品类型，不能用它推断卖家在同一品类集中发布。
    sameCategoryRatio: category === "other" ? 0 : activeRows.filter((row) => row.category === category).length / denominator,
    sameCategoryCount: category === "other" ? 0 : activeRows.filter((row) => row.category === category).length,
  };
}

export async function loadSourceProducts(ids: number[], databaseUrl: string): Promise<SourceProduct[]> {
  if (ids.length === 0) return [];
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 5, prepare: false });
  try {
    let rows;
    try {
      // 详情与主页快照按采集器最新表结构读取；主页表按卖家平台 ID 关联。
      rows = await client`
        select p.id, p.title, p.price, p.area, p.seller, p.link, p.image_url, p.image_urls, p.publish_time,
               p.detail_json, p.seller_user_id, sp.profile_json as seller_profile_json
        from xianyu_products p
        left join xianyu_seller_profiles sp on sp.seller_user_id = p.seller_user_id
        where p.id in ${client(ids)}`;
    } catch {
      try {
        rows = await client`select id, title, price, area, seller, link, image_url, image_urls, publish_time, detail_json, seller_user_id from xianyu_products where id in ${client(ids)}`;
      } catch {
        rows = await client`select id, title, price, area, seller, link, image_url, publish_time from xianyu_products where id in ${client(ids)}`;
      }
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
    filterCode: assessment.filterCode ?? null,
    knowledgeUsed: assessment.knowledgeUsed ?? [],
    priceReferenceUsed: assessment.priceReferenceUsed ?? null,
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

export interface SaveListingsOutcome {
  /** 内容指纹变化、需要重新评估的商品数。 */
  imported: number;
  /** 当前命中前置过滤器的商品数。 */
  filtered: number;
  /** 本轮结束后仍没有 JEV 评分的商品数（评分不可用或尚未评分）。 */
  pendingEvaluation: number;
  /** 命中卖家排除记录、未入库的商品数。 */
  excludedListings?: number;
  /** 命中商品忽略记录、未入库的商品数。 */
  ignoredListings?: number;
}

export async function saveListings(listings: MarketplaceListing[], sourceProducts: SourceProduct[], scanScope: string): Promise<SaveListingsOutcome> {
  const { db } = getDatabase();
  const env = getServerEnv();
  // 正式入库前核查统一排除与商品处理状态（方案 5.8）。
  // 排除服务不可用时此处抛错、整批不写：黑名单不可知期间宁可暂停导入，也不放行商家商品。
  const [exclusionMap, handlingMap] = await Promise.all([loadActiveExclusionMap(), loadHandlingMap()]);
  const sellerRuleSettings = await loadSellerRuleSettings();
  const preFilterSettings = await loadPreFilterSettings();
  const activePreFilterConfigs: PreFilterConfigs = { ...preFilterSettings.configs, sellerThresholds: sellerRuleSettings.enabled === false ? null : sellerRuleSettings.thresholds };
  const activeKnowledge = await loadActiveKnowledgeEntries();
  const jevEnabled = env.TYPESAFE_ENABLED === "true";
  let imported = 0;
  let filtered = 0;
  let pendingEvaluation = 0;
  let excludedListings = 0;
  let ignoredListings = 0;
  const seenExternalIds = new Set(listings.map((listing) => listing.externalId));
  const workItems: Array<{
    id: string;
    sellerId: string;
    listing: MarketplaceListing;
    priorSignals: SellerSignals | null;
    rawPayload: Record<string, unknown>;
    profile: SellerProfileSnapshot | null;
  }> = [];

  for (const listing of listings) {
    // 商品忽略记录：旧商品不再进入待处理；卖家其他新货仍正常筛选（方案 3.1）。
    if (handlingMap.has(listing.externalId)) {
      ignoredListings += 1;
      continue;
    }
    // 卖家排除记录：按弱身份与稳定身份键分别匹配，命中即不入库（方案 5.3）。
    const exclusionHit = matchExclusion(sellerIdentityCandidates({
      displayName: listing.seller.displayName,
      region: listing.seller.region,
      stableId: listing.seller.identityScope === "stable-platform-id"
        ? listing.seller.externalId.slice("xianyu-user-".length)
        : undefined,
    }), exclusionMap);
    if (exclusionHit) {
      excludedListings += 1;
      continue;
    }
    const sourceProduct = sourceProducts.find((product) => xianyuProductExternalId(product.link, product.id) === listing.externalId);
    const profile = parseSellerProfileSnapshot(sourceProduct?.seller_profile_json);
    // 卖家身份升级：拿到稳定平台 ID 时，把旧“昵称+地区”行原位改名，历史线索关联保持不变。
    if (listing.seller.identityScope === "stable-platform-id") {
      const legacyId = legacySellerExternalId(listing.seller.displayName, listing.seller.region);
      if (legacyId !== listing.seller.externalId) {
        const [legacySeller] = await db.select({ id: sellers.id }).from(sellers).where(and(eq(sellers.platform, "xianyu"), eq(sellers.externalId, legacyId))).limit(1);
        if (legacySeller) {
          const [stableSeller] = await db.select({ id: sellers.id }).from(sellers).where(and(eq(sellers.platform, "xianyu"), eq(sellers.externalId, listing.seller.externalId))).limit(1);
          if (stableSeller) {
            await db.update(marketplaceListings).set({ sellerId: stableSeller.id, updatedAt: new Date() }).where(eq(marketplaceListings.sellerId, legacySeller.id));
            await db.delete(sellers).where(eq(sellers.id, legacySeller.id));
          } else {
            await db.update(sellers).set({ externalId: listing.seller.externalId, displayName: listing.seller.displayName, region: listing.seller.region, updatedAt: new Date() }).where(eq(sellers.id, legacySeller.id));
          }
        }
      }
    }
    // 身份归并：还没补到详情的线索按昵称挂到已知的稳定卖家行，避免同品类计数被拆散。
    // 仅在昵称唯一对应一个稳定卖家行时归并；重名歧义时维持原身份。
    let attachedSellerId: string | undefined;
    if (listing.seller.identityScope !== "stable-platform-id" && listing.seller.displayName.trim()) {
      const stableMatches = await db
        .select({ id: sellers.id })
        .from(sellers)
        .where(and(eq(sellers.platform, "xianyu"), eq(sellers.displayName, listing.seller.displayName), like(sellers.externalId, "xianyu-user-%")));
      const uniqueIds = [...new Set(stableMatches.map((row) => row.id))];
      if (uniqueIds.length === 1) attachedSellerId = uniqueIds[0];
    }
    const [seller] = attachedSellerId
      ? [{ id: attachedSellerId }]
      : await db.insert(sellers).values({
        platform: "xianyu",
        externalId: listing.seller.externalId,
        identityKey: weakIdentityKey(listing.seller.displayName, listing.seller.region),
        displayName: listing.seller.displayName,
        region: listing.seller.region,
        profileSnapshot: { source: "xianyu-spider", completeness: profile ? "complete-profile" : "nickname-only" },
      }).onConflictDoUpdate({
        target: [sellers.platform, sellers.externalId],
        set: {
          displayName: listing.seller.displayName,
          region: listing.seller.region,
          identityKey: weakIdentityKey(listing.seller.displayName, listing.seller.region),
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      }).returning({ id: sellers.id });
    const detail = parseDetailSnapshot(sourceProduct?.detail_json);
    const [existing] = await db.select({ id: marketplaceListings.id, contentFingerprint: marketplaceListings.contentFingerprint, rawPayload: marketplaceListings.rawPayload }).from(marketplaceListings).where(and(eq(marketplaceListings.platform, "xianyu"), eq(marketplaceListings.externalId, listing.externalId))).limit(1);
    const previousPayload = existing?.rawPayload && typeof existing.rawPayload === "object" && !Array.isArray(existing.rawPayload)
      ? existing.rawPayload as { monitorKeywords?: unknown; monitorScopes?: unknown } : {};
    const previousKeywords = Array.isArray(previousPayload.monitorKeywords)
      ? previousPayload.monitorKeywords.filter((value): value is string => typeof value === "string") : [];
    const previousScopes = Array.isArray(previousPayload.monitorScopes)
      ? previousPayload.monitorScopes.filter((value): value is string => typeof value === "string") : [];
    listing.monitorKeywords = [...new Set([...previousKeywords, ...listing.monitorKeywords])];
    const nextFingerprint = fingerprint(listing);
    const priorSignals = existing ? readSellerSignals(existing.rawPayload) : null;
    const rawPayload = {
      collector: "xianyu-spider-compatible",
      sourceProductId: sourceProduct?.id,
      sellerName: listing.seller.displayName,
      monitorKeywords: listing.monitorKeywords,
      monitorScopes: [...new Set([...previousScopes, scanScope])],
      ...(detail ? {
        detailSummary: {
          wantCount: detail.wantCount,
          viewCount: detail.viewCount,
          soldCount: detail.soldCount,
          attributeCount: detail.attributes.length,
        },
      } : {}),
      ...(profile ? { sellerProfileSummary: profile } : {}),
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
      workItems.push({ id: inserted.id, sellerId: seller.id, listing, priorSignals: null, rawPayload, profile });
      imported += 1;
      continue;
    }

    const changed = existing.contentFingerprint !== nextFingerprint && !legacyFingerprints(listing).includes(existing.contentFingerprint ?? "");
    await db.update(marketplaceListings).set(listingValues).where(eq(marketplaceListings.id, existing.id));
    workItems.push({ id: existing.id, sellerId: seller.id, listing, priorSignals, rawPayload, profile });
    if (changed) imported += 1;
  }

  // 先写入本批次全部商品，再计算卖家画像，避免同一卖家的前几条记录看不到后续商品。
  const sellerSignalsCache = new Map<string, SellerSignals>();
  const sellerSnapshotCache = new Map<string, SellerProfileRecord | null>();
  const latestAssessments = new Map<string, { inputFingerprint: string | null; modelVersion: string | null }>();
  const storedReferences = new Map<string, { id: string; amount: number; version: number }>();
  if (workItems.length > 0) {
    const referenceRows = await db.select({ id: marketplaceListings.id, referenceId: marketplaceListings.marketReferenceId, amount: marketplaceListings.marketReferencePrice, version: marketplaceListings.marketReferenceVersion, expiresAt: marketplaceListings.marketReferenceExpiresAt })
      .from(marketplaceListings).where(inArray(marketplaceListings.id, workItems.map((item) => item.id)));
    for (const row of referenceRows) if (row.referenceId !== null && row.amount !== null && row.version !== null && row.expiresAt && row.expiresAt.getTime() > Date.now()) storedReferences.set(row.id, { id: row.referenceId, amount: Number(row.amount), version: row.version });
    const persistedAssessments = await db.select({ listingId: assessments.listingId, inputFingerprint: assessments.inputFingerprint, modelVersion: assessments.modelVersion }).from(assessments).where(inArray(assessments.listingId, workItems.map((item) => item.id))).orderBy(desc(assessments.evaluatedAt));
    for (const row of persistedAssessments) {
      if (!latestAssessments.has(row.listingId)) latestAssessments.set(row.listingId, { inputFingerprint: row.inputFingerprint, modelVersion: row.modelVersion });
    }
  }
  for (const item of workItems) {
    const cacheKey = `${item.sellerId}:${item.listing.category}`;
    const signals = sellerSignalsCache.get(cacheKey) ?? await loadSellerSignals(db, item.sellerId, item.listing.category);
    sellerSignalsCache.set(cacheKey, signals);
    // 有主页快照时把平台侧事实（卖出件数、信用等）与已采集观察合并写入卖家画像；
    // 本条商品没有 JOIN 到主页时保留已有平台事实，避免被纯观察数据覆盖降级。
    const completeProfile = item.profile !== null;
    const detailSoldCount = item.listing.seller.completedSaleCount;
    if (!completeProfile && !sellerSnapshotCache.has(item.sellerId)) {
      const [row] = await db.select({ snapshot: sellers.profileSnapshot }).from(sellers).where(eq(sellers.id, item.sellerId)).limit(1);
      const snapshot = row?.snapshot;
      sellerSnapshotCache.set(item.sellerId, snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && (snapshot as Record<string, unknown>).completeness === "complete-profile"
        ? snapshot as SellerProfileRecord
        : null);
    }
    const preservedProfile = !completeProfile ? sellerSnapshotCache.get(item.sellerId) ?? null : null;
    const hasPlatformProfile = completeProfile || preservedProfile !== null;
    // 已核验卖出数的取数优先级：主页统计 → 本商品详情的卖家卡片 → 之前写入的卖家画像。
    const profileSoldCount = item.profile?.soldCount;
    const soldSource: SellerProfileRecord | null =
      typeof profileSoldCount === "number" ? { completedSaleCount: profileSoldCount, completedSaleCountVerified: true }
      : typeof detailSoldCount === "number" ? { completedSaleCount: detailSoldCount, completedSaleCountVerified: item.listing.seller.completedSaleCountVerified === true }
      : typeof preservedProfile?.completedSaleCount === "number"
        ? { completedSaleCount: preservedProfile.completedSaleCount, completedSaleCountVerified: preservedProfile.completedSaleCountVerified === true }
        : null;
    if (completeProfile) {
      // 同批次后续无主页的商品要沿用这条刚写入的平台事实，缓存随之更新。
      sellerSnapshotCache.set(item.sellerId, {
        completeness: "complete-profile",
        ...(soldSource ?? {}),
        onSaleCount: item.profile?.onSaleCount,
        creditLevel: item.profile?.creditLevel,
        categoryMix: item.profile?.categoryCounts,
        profileFetchedAt: new Date().toISOString(),
      });
    }
    await db.update(sellers).set({
      profileSnapshot: {
        source: "xianyu-spider",
        completeness: hasPlatformProfile ? "complete-profile" : "observed-listings",
        activeListingCount: signals.activeListingCount,
        sameCategoryRatio: signals.sameCategoryRatio,
        sameCategoryCount: signals.sameCategoryCount,
        ...(completeProfile && item.profile ? {
          onSaleCount: item.profile.onSaleCount,
          creditLevel: item.profile.creditLevel,
          categoryMix: item.profile.categoryCounts,
          profileFetchedAt: new Date().toISOString(),
        } : {}),
        ...(preservedProfile ? {
          ...(typeof preservedProfile.onSaleCount === "number" ? { onSaleCount: preservedProfile.onSaleCount } : {}),
          ...(typeof preservedProfile.creditLevel === "string" ? { creditLevel: preservedProfile.creditLevel } : {}),
          ...(preservedProfile.categoryMix && typeof preservedProfile.categoryMix === "object" ? { categoryMix: preservedProfile.categoryMix } : {}),
          ...(typeof preservedProfile.profileFetchedAt === "string" ? { profileFetchedAt: preservedProfile.profileFetchedAt } : {}),
        } : {}),
        ...(soldSource ?? {}),
        signalScope: hasPlatformProfile ? "complete-profile" : "当前已入库的活跃商品，不等同于完整主页统计",
      },
      updatedAt: new Date(),
    }).where(eq(sellers.id, item.sellerId));

    await db.update(marketplaceListings).set({ rawPayload: { ...item.rawPayload, sellerSignals: signals } }).where(eq(marketplaceListings.id, item.id));

    const enrichedListing = {
      ...item.listing,
      id: item.id,
      ...(storedReferences.has(item.id) ? { marketReferencePrice: storedReferences.get(item.id)!.amount, marketReferenceId: storedReferences.get(item.id)!.id, marketReferenceVersion: storedReferences.get(item.id)!.version } : {}),
      seller: {
        ...item.listing.seller,
        ...signals,
        ...(preservedProfile && typeof preservedProfile.onSaleCount === "number" && item.listing.seller.onSaleCount === undefined ? { onSaleCount: preservedProfile.onSaleCount } : {}),
        ...(preservedProfile && preservedProfile.categoryMix && typeof preservedProfile.categoryMix === "object" && item.listing.seller.profileCategoryMix === undefined
          ? { profileCategoryMix: preservedProfile.categoryMix as Record<string, number> } : {}),
        ...(preservedProfile && typeof preservedProfile.creditLevel === "string" && item.listing.seller.creditLevel === undefined ? { creditLevel: preservedProfile.creditLevel } : {}),
        ...(preservedProfile && typeof preservedProfile.completedSaleCount === "number" && item.listing.seller.completedSaleCount === undefined
          ? { completedSaleCount: preservedProfile.completedSaleCount, completedSaleCountVerified: preservedProfile.completedSaleCountVerified === true }
          : {}),
        signalScope: hasPlatformProfile ? ("complete-profile" as const) : ("observed-listings" as const),
      },
    };

    const filterHit = runPreFilters(enrichedListing, activePreFilterConfigs);
    if (filterHit) {
      filtered += 1;
      const assessmentInputFingerprint = filteredAssessmentFingerprint(enrichedListing, filterHit, activePreFilterConfigs);
      if (latestAssessments.get(item.id)?.inputFingerprint === assessmentInputFingerprint) continue;
      const record = filteredAssessment(enrichedListing, filterHit);
      record.priceReferenceUsed = priceReferenceSnapshot(enrichedListing) ?? undefined;
      await db.insert(assessments).values({ listingId: item.id, ...assessmentValues(record, assessmentInputFingerprint) }).onConflictDoNothing({ target: [assessments.listingId, assessments.inputFingerprint] });
      continue;
    }

    // 未命中过滤器的商品必须有 JEV 评分；评分不可用时不落任何评估记录，
    // 线索保持待评分状态，恢复后的下一次扫描经 inputFingerprint 自动补评。
    const selectedKnowledge = selectKnowledge(activeKnowledge, enrichedListing);
    const scoredFingerprint = scoredAssessmentFingerprint(enrichedListing, activePreFilterConfigs.sellerThresholds, knowledgeHash(selectedKnowledge));
    if (latestAssessments.get(item.id)?.inputFingerprint === scoredFingerprint && latestAssessments.get(item.id)?.modelVersion !== null) continue;

    const facts = buildRuleFacts(enrichedListing, new Date());
    if (!jevEnabled) {
      pendingEvaluation += 1;
      continue;
    }
    const jev = await evaluateListing(enrichedListing, facts, { sellerRuleThresholds: activePreFilterConfigs.sellerThresholds, knowledge: selectedKnowledge });
    if (!jev) {
      pendingEvaluation += 1;
      continue;
    }
    const finalAssessment = finalizeAssessment(enrichedListing, facts, jev, { confidenceThreshold: env.TYPESAFE_CONFIDENCE_THRESHOLD });
    finalAssessment.knowledgeUsed = knowledgeUsed(selectedKnowledge);
    finalAssessment.priceReferenceUsed = priceReferenceSnapshot(enrichedListing) ?? undefined;
    if (selectedKnowledge.length > 0) finalAssessment.evidence.push({ code: "jev-knowledge-context", kind: "neutral", label: "已向 JEV 提供知识经验", detail: `本次注入 ${selectedKnowledge.length} 条已批准知识；这只表示进入评分输入，不代表模型逐条采纳。`, scoreImpact: 0, source: "knowledge" });
    await db.insert(assessments).values({ listingId: item.id, ...assessmentValues(finalAssessment, scoredFingerprint) }).onConflictDoNothing({ target: [assessments.listingId, assessments.inputFingerprint] });
  }

  if (seenExternalIds.size > 0) {
    const activeListings = await db.select({ id: marketplaceListings.id, externalId: marketplaceListings.externalId, absentScanCount: marketplaceListings.absentScanCount, rawPayload: marketplaceListings.rawPayload }).from(marketplaceListings).where(and(eq(marketplaceListings.platform, "xianyu"), eq(marketplaceListings.status, "active")));
    for (const row of activeListings) {
      if (seenExternalIds.has(row.externalId)) continue;
      const payload = row.rawPayload && typeof row.rawPayload === "object" && !Array.isArray(row.rawPayload) ? row.rawPayload as { monitorScopes?: unknown } : {};
      const previousScopes = Array.isArray(payload.monitorScopes) ? payload.monitorScopes.filter((value): value is string => typeof value === "string") : [];
      // 只有相同关键词、地点、价格、时间和页数的再次扫描才能判断缺席。
      // 老数据没有搜索范围记录，先等待下一次被同一范围采到，避免误标已卖。
      if (!previousScopes.includes(scanScope)) continue;
      const absentScanCount = row.absentScanCount + 1;
      await db.update(marketplaceListings).set({ absentScanCount, status: absentScanCount >= 3 ? "possibly_sold" : "active", updatedAt: new Date() }).where(eq(marketplaceListings.id, row.id));
    }
  }
  return { imported, filtered, pendingEvaluation, excludedListings, ignoredListings };
}
