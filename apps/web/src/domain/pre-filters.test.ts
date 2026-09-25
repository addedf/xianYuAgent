import { describe, expect, it } from "vitest";
import type { MarketplaceListing } from "./listing";
import { DEFAULT_PRE_FILTER_CONFIGS, runPreFilters, SELLER_NON_PERSONAL_FILTER_CODE } from "./pre-filters";

function listingFixture(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-1", externalId: "e-1", platform: "xianyu", category: "watch", brand: "劳力士", model: "日志型",
    title: "自用劳力士日志型", description: "自用几年，成色不错", price: 50000, marketReferencePrice: 70000,
    region: "广州", publishedAt: "2026-09-24T08:00:00.000Z", firstSeenAt: "2026-09-24T08:01:00.000Z",
    imageUrls: [], duplicateImageCount: 0, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false,
    monitorKeywords: ["劳力士"],
    seller: { externalId: "s-1", displayName: "林小姐", region: "广州", activeListingCount: 0, sameCategoryRatio: 0, templateSimilarity: 0, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
    ...overrides,
  };
}

describe("runPreFilters", () => {
  it("hard-blocks counterfeit terms first", () => {
    const hit = runPreFilters(listingFixture({ title: "复刻劳力士 一比一" }));
    expect(hit?.code).toBe("listing-counterfeit-terms");
    expect(hit?.riskLevel).toBe("high");
  });

  it("supports configured counterfeit terms", () => {
    const hit = runPreFilters(listingFixture({ title: "海马300 出" }), { ...DEFAULT_PRE_FILTER_CONFIGS, counterfeitTerms: ["海马300"] });
    expect(hit?.code).toBe("listing-counterfeit-terms");
  });

  it("skips a disabled filter instead of falling back to code defaults", () => {
    expect(runPreFilters(listingFixture({ title: "复刻劳力士" }), { ...DEFAULT_PRE_FILTER_CONFIGS, counterfeitTerms: null })).toBeNull();
    expect(runPreFilters(listingFixture({ price: 9000 }), { ...DEFAULT_PRE_FILTER_CONFIGS, extremePriceRatio: null })).toBeNull();
  });

  it("blocks extreme price gaps below the configured ratio", () => {
    const hit = runPreFilters(listingFixture({ price: 9000, marketReferencePrice: 70000 }));
    expect(hit?.code).toBe("listing-extreme-price-gap");
    expect(hit?.riskLevel).toBe("medium");
    expect(runPreFilters(listingFixture({ price: 15000, marketReferencePrice: 70000 }))).toBeNull();
  });

  it("blocks non-personal sellers only with observed signals", () => {
    const professional = listingFixture({
      seller: { externalId: "s-2", displayName: "腕表之家", region: "广州", activeListingCount: 9, sameCategoryCount: 9, sameCategoryRatio: 1, signalScope: "observed-listings", templateSimilarity: 0.2, hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
    });
    const hit = runPreFilters(professional);
    expect(hit?.code).toBe(SELLER_NON_PERSONAL_FILTER_CODE);
    expect(hit?.riskLevel).toBe("medium");

    // 没有任何观察信号（在架 0 且非完整画像）时不判定，交给 JEV 处理。
    expect(runPreFilters(listingFixture())).toBeNull();
  });

  it("blocks sellers with a large on-sale count from the profile snapshot", () => {
    const merchant = listingFixture({
      seller: { externalId: "xianyu-user-2220370408262", displayName: "正品奢侈品", region: "广州", activeListingCount: 1, sameCategoryCount: 1, sameCategoryRatio: 1, onSaleCount: 2998, signalScope: "complete-profile", templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
    });
    const hit = runPreFilters(merchant);
    expect(hit?.code).toBe(SELLER_NON_PERSONAL_FILTER_CODE);
    expect(hit?.detail).toContain("主页在售数量为 2998 件");

    // 在售数低于阈值时不命中。
    const casual = listingFixture({
      seller: { externalId: "xianyu-user-1", displayName: "小王", region: "广州", activeListingCount: 1, sameCategoryCount: 1, sameCategoryRatio: 1, onSaleCount: 12, signalScope: "complete-profile", templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
    });
    expect(runPreFilters(casual)).toBeNull();
  });

  it("uses verified homepage category samples even when total on-sale and sold counts are below their thresholds", () => {
    const seller = {
      externalId: "xianyu-user-watch-shop", displayName: "表行", region: "广州", activeListingCount: 1,
      sameCategoryCount: 1, sameCategoryRatio: 1, onSaleCount: 20, completedSaleCount: 33,
      completedSaleCountVerified: true, identityScope: "stable-platform-id" as const,
      signalScope: "complete-profile" as const, profileCategoryMix: { 腕表: 20, 箱包: 7 },
      templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false,
    };
    const hit = runPreFilters(listingFixture({ seller }));
    expect(hit?.code).toBe(SELLER_NON_PERSONAL_FILTER_CODE);
    expect(hit?.detail).toContain("主页在售采样中同品类商品 20 条");
    expect(runPreFilters(listingFixture({ seller: { ...seller, profileCategoryMix: { 腕表: 2, 箱包: 25 } } }))).toBeNull();
    expect(runPreFilters(listingFixture({ seller: { ...seller, identityScope: "nickname-region" } }))).toBeNull();
    expect(runPreFilters(listingFixture({ seller: { ...seller, signalScope: "observed-listings" } }))).toBeNull();
  });

  it("does not block sellers below the thresholds", () => {
    const smallSeller = listingFixture({
      seller: { externalId: "s-3", displayName: "小王", region: "广州", activeListingCount: 3, sameCategoryCount: 2, sameCategoryRatio: 0.67, signalScope: "observed-listings", templateSimilarity: 0.1, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
    });
    expect(runPreFilters(smallSeller)).toBeNull();
  });

  it("falls back to default configs when omitted", () => {
    expect(DEFAULT_PRE_FILTER_CONFIGS.extremePriceRatio).toBe(0.18);
    expect(runPreFilters(listingFixture({ title: "复刻手表" }))).not.toBeNull();
  });
});
