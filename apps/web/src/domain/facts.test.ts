import { describe, expect, it } from "vitest";
import type { MarketplaceListing } from "./listing";
import { buildRuleFacts, calculateRecency, containsAny, suggestedQuestionsFromMissing } from "./facts";

function listingFixture(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-1", externalId: "e-1", platform: "xianyu", category: "watch", brand: "劳力士", model: "日志型",
    title: "自用劳力士日志型", description: "自用几年，保卡票据齐全", price: 50000, marketReferencePrice: 70000,
    region: "广州", publishedAt: "2026-09-24T08:00:00.000Z", firstSeenAt: "2026-09-24T08:01:00.000Z",
    imageUrls: ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg", "https://img.example.com/3.jpg", "https://img.example.com/4.jpg", "https://img.example.com/5.jpg"],
    duplicateImageCount: 0, hasSerialDetail: true, hasPurchaseProof: true, hasAccessoryDescription: true,
    monitorKeywords: ["劳力士", "日志型"],
    seller: { externalId: "s-1", displayName: "林小姐", region: "广州", activeListingCount: 2, sameCategoryRatio: 0.5, templateSimilarity: 0.1, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
    ...overrides,
  };
}

describe("containsAny", () => {
  it("matches terms case-insensitively", () => {
    expect(containsAny("Rolex 一比一", ["一比一", "复刻"])).toEqual(["一比一"]);
    expect(containsAny("正常描述", ["复刻"])).toEqual([]);
  });
});

describe("suggestedQuestionsFromMissing", () => {
  it("keeps at most three questions", () => {
    expect(suggestedQuestionsFromMissing(["a", "b", "c", "d"])).toEqual(["方便补充a吗？", "方便补充b吗？", "方便补充c吗？"]);
    expect(suggestedQuestionsFromMissing([])).toEqual([]);
  });
});

describe("calculateRecency", () => {
  const now = new Date("2026-09-24T10:00:00.000Z");
  it("buckets by publication age", () => {
    expect(calculateRecency("2026-09-24T09:55:00.000Z", now)).toBe(100);
    expect(calculateRecency("2026-09-24T09:35:00.000Z", now)).toBe(88);
    expect(calculateRecency("2026-09-24T08:30:00.000Z", now)).toBe(68);
    expect(calculateRecency("2026-09-24T05:30:00.000Z", now)).toBe(45);
    expect(calculateRecency("2026-09-23T20:00:00.000Z", now)).toBe(24);
    expect(calculateRecency("2026-09-20T10:00:00.000Z", now)).toBe(8);
    expect(calculateRecency("不是时间", now)).toBe(0);
  });
});

describe("buildRuleFacts", () => {
  const now = new Date("2026-09-24T10:00:00.000Z");

  it("collects risk issues for counterfeit terms, price gaps, duplicate images and seller patterns", () => {
    const facts = buildRuleFacts(listingFixture({
      title: "复刻劳力士 专柜品质",
      description: "一比一版本",
      marketReferencePrice: 70000,
      price: 9000,
      duplicateImageCount: 2,
      seller: { externalId: "s-9", displayName: "工厂店", region: "广州", activeListingCount: 8, sameCategoryRatio: 0.9, templateSimilarity: 0.8, hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
    }), now);

    const codes = facts.issues.map((issue) => issue.code);
    expect(codes).toContain("listing-suspicious-terms");
    expect(codes).toContain("listing-extreme-price-gap");
    expect(codes).toContain("listing-duplicate-images");
    expect(codes).toContain("seller-template-copy");
    expect(codes).toContain("seller-category-concentration");
  });

  it("does not flag the price gap when the ratio stays above the threshold", () => {
    const facts = buildRuleFacts(listingFixture({ price: 63000, marketReferencePrice: 70000 }), now);
    expect(facts.issues.map((issue) => issue.code)).not.toContain("listing-extreme-price-gap");
  });

  it("collects positives for personal story, natural scene and proof plus serial", () => {
    const facts = buildRuleFacts(listingFixture(), now);
    expect(facts.positives.map((item) => item.code)).toEqual(["seller-personal-story", "seller-natural-scene", "listing-proof-and-serial"]);
  });

  it("lists the missing checklist and derives suggested questions", () => {
    const facts = buildRuleFacts(listingFixture({
      description: "出",
      hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false,
      imageUrls: [],
    }), now);
    expect(facts.missing).toEqual([
      "更完整的购买与使用说明",
      "关键细节多角度图片",
      "序列号或身份编码细节",
      "购买凭证或来源证明",
      "附件、包装与维修史说明",
    ]);
    expect(facts.suggestedQuestions).toHaveLength(3);
  });

  it("derives hard facts from keywords, margin and publication age", () => {
    const facts = buildRuleFacts(listingFixture(), now);
    expect(facts.hardFacts.categoryMatch).toBe(96);
    // marginRatio = (70000 - 50000) / 70000 ≈ 0.286 → 40 + 25.7 ≈ 66。
    expect(facts.hardFacts.profitOpportunity).toBe(66);
    expect(facts.hardFacts.priceVsReference).toBeCloseTo(50000 / 70000);
  });

  it("matches every word in a multiword search phrase", () => {
    const facts = buildRuleFacts(listingFixture({ monitorKeywords: ["劳力士 日志型"] }), now);
    expect(facts.hardFacts.categoryMatch).toBe(96);
  });

  it("falls back to neutral hard facts without keyword hits or reference price", () => {
    const facts = buildRuleFacts(listingFixture({ brand: "无匹配", monitorKeywords: ["不相关"], model: undefined, marketReferencePrice: undefined }), now);
    expect(facts.hardFacts.categoryMatch).toBe(68);
    expect(facts.hardFacts.profitOpportunity).toBe(45);
    expect(facts.hardFacts.priceVsReference).toBeNull();
  });
});
