import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRE_FILTER_CONFIGS } from "@/src/domain/pre-filters";

const mocks = vi.hoisted(() => ({
  adminApiError: vi.fn(() => null),
  loadLatestAssessedListings: vi.fn(),
  loadSellerRuleSettings: vi.fn(),
  loadPreFilterSettings: vi.fn(),
  loadActiveKnowledgeEntries: vi.fn(),
  evaluateListing: vi.fn(),
  getServerEnv: vi.fn(() => ({ TYPESAFE_CONFIDENCE_THRESHOLD: 55 })),
  upsert: vi.fn(),
}));

vi.mock("@/src/server/auth/admin-request", () => ({ adminApiError: mocks.adminApiError }));
vi.mock("@/src/server/listings", () => ({ loadLatestAssessedListings: mocks.loadLatestAssessedListings }));
vi.mock("@/src/server/seller-rule-settings", () => ({ loadSellerRuleSettings: mocks.loadSellerRuleSettings }));
vi.mock("@/src/server/pre-filter-settings", () => ({ loadPreFilterSettings: mocks.loadPreFilterSettings }));
vi.mock("@/src/server/knowledge-injection", () => ({ loadActiveKnowledgeEntries: mocks.loadActiveKnowledgeEntries }));
vi.mock("@/src/server/evaluators/typesafe", () => ({ evaluateListing: mocks.evaluateListing }));
vi.mock("@/src/server/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/src/server/db/schema", () => ({ assessments: { listingId: "listing_id", inputFingerprint: "input_fingerprint" }, assessmentRuns: {} }));
vi.mock("@/src/server/db/client", () => ({ getDatabase: () => ({ db: { insert: () => ({ values: (value: unknown) => mocks.upsert(value) }) } }) }));
vi.mock("@/src/server/sources/xianyu-spider-persistence", () => ({
  scoredAssessmentFingerprint: vi.fn(() => "scored-fingerprint"),
  filteredAssessmentFingerprint: vi.fn(() => "filtered-fingerprint"),
}));

import { POST } from "./route";

const listingId = "11111111-1111-4111-8111-111111111111";
const sellerRuleThresholds = { sameCategoryMinCount: 6, completedSaleMinCount: 200, onSaleMinCount: 50 };
const item = {
  listing: {
    id: listingId, externalId: "item-1", platform: "xianyu" as const, category: "watch" as const, brand: "劳力士", title: "腕表",
    description: "自用闲置腕表，票证齐全", price: 1000, marketReferencePrice: 2000, region: "广州", publishedAt: "2026-09-01T00:00:00.000Z",
    firstSeenAt: "2026-09-01T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0,
    hasSerialDetail: true, hasPurchaseProof: true, hasAccessoryDescription: true, monitorKeywords: ["劳力士"],
    seller: { externalId: "seller-1", displayName: "卖家", region: "广州", activeListingCount: 2, sameCategoryCount: 1, sameCategoryRatio: 0.5, templateSimilarity: 0, hasPersonalStorySignals: true, hasNaturalSceneSignals: false },
  },
  assessment: {},
};
const jev = {
  modelVersion: "jev-test", questionsVersion: "questions-test", stateFingerprint: "state-fp",
  scores: {
    personalSeller: { score: 85, confidence: 0.9, probabilities: {}, signal: "个人叙述明确" },
    authenticityRisk: { score: 20, confidence: 0.85, probabilities: {}, signal: "无疑假话术" },
    informationCompleteness: { score: 70, confidence: 0.8, probabilities: {}, signal: "凭证齐全" },
  },
  sellerType: { choice: "personal", confidence: 0.9, probabilities: {} },
  counterfeitClaim: 0.05, personalStory: 0.9, raw: {},
};

function request(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/assessments/rescore", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    body: JSON.stringify(body),
  });
}

describe("manual rescore route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminApiError.mockReturnValue(null);
    mocks.loadLatestAssessedListings.mockResolvedValue([item]);
    mocks.loadSellerRuleSettings.mockResolvedValue({ thresholds: sellerRuleThresholds, version: 1, persisted: false });
    mocks.loadPreFilterSettings.mockResolvedValue({ configs: DEFAULT_PRE_FILTER_CONFIGS, persisted: false });
    mocks.loadActiveKnowledgeEntries.mockResolvedValue([]);
    mocks.evaluateListing.mockResolvedValue(jev);
    mocks.getServerEnv.mockReturnValue({ TYPESAFE_CONFIDENCE_THRESHOLD: 55 });
    mocks.upsert.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
  });

  it("runs the full pipeline and persists the finalized JEV score", async () => {
    const response = await POST(request({ listingId }));

    // 规则硬事实：categoryMatch 96、profit 85、recency 8（发布已久）；JEV 三维 85/20/70。
    // total = 96*.1 + 85*.3 + 80*.3 + 70*.1 + 85*.15 + 8*.05 = 79。
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, jevEvaluated: true, totalOpportunity: 79 });
    expect(mocks.evaluateListing).toHaveBeenCalledWith(item.listing, expect.objectContaining({ issues: expect.any(Array), hardFacts: expect.anything() }), { mode: "manual", sellerRuleThresholds, knowledge: [] });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      inputFingerprint: "scored-fingerprint",
      filterCode: null,
      totalOpportunity: 79,
      modelVersion: "jev-test",
    }));
  });

  it("returns 503 and persists nothing when JEV is unavailable", async () => {
    mocks.evaluateListing.mockResolvedValue(null);
    const response = await POST(request({ listingId }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("保持待评分") });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records the pre-filter result instead of calling JEV when a filter hits", async () => {
    const filteredItem = { ...item, listing: { ...item.listing, title: "复刻腕表 专柜品质", description: "一比一版本" } };
    mocks.loadLatestAssessedListings.mockResolvedValue([{ ...item, listing: filteredItem.listing }]);
    const response = await POST(request({ listingId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, jevEvaluated: false, filterCode: "listing-counterfeit-terms", totalOpportunity: 0 });
    expect(mocks.evaluateListing).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      inputFingerprint: "filtered-fingerprint",
      filterCode: "listing-counterfeit-terms",
      totalOpportunity: 0,
    }));
  });

  it("uses the persisted seller threshold for pre-filtering", async () => {
    const seller = { ...item.listing.seller, completedSaleCount: 150, completedSaleCountVerified: true, signalScope: "complete-profile" };
    mocks.loadLatestAssessedListings.mockResolvedValue([{ ...item, listing: { ...item.listing, seller } }]);
    const response = await POST(request({ listingId }));
    expect((await response.json()).jevEvaluated).toBe(true);
    expect(mocks.evaluateListing).toHaveBeenCalledOnce();

    mocks.evaluateListing.mockClear();
    mocks.loadSellerRuleSettings.mockResolvedValue({ thresholds: { ...sellerRuleThresholds, completedSaleMinCount: 100 }, version: 2, persisted: true });
    const filteredResponse = await POST(request({ listingId }));
    expect(await filteredResponse.json()).toMatchObject({ filterCode: "seller-non-personal-thresholds", jevEvaluated: false });
    expect(mocks.evaluateListing).not.toHaveBeenCalled();
  });

  it("rejects malformed listing IDs before querying data", async () => {
    const response = await POST(request({ listingId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(mocks.loadLatestAssessedListings).not.toHaveBeenCalled();
  });
});
