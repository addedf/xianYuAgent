import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminApiError: vi.fn(() => null),
  loadLatestAssessedListings: vi.fn(),
  assessListing: vi.fn(),
  evaluateListing: vi.fn(),
  getServerEnv: vi.fn(() => ({ TYPESAFE_ENABLED: "false", TYPESAFE_CONFIDENCE_THRESHOLD: 55 })),
  upsert: vi.fn(),
}));

vi.mock("@/src/server/auth/admin-request", () => ({ adminApiError: mocks.adminApiError }));
vi.mock("@/src/server/listings", () => ({ loadLatestAssessedListings: mocks.loadLatestAssessedListings }));
vi.mock("@/src/domain/scoring", () => ({ assessListing: mocks.assessListing, RULESET_VERSION: "rules-test" }));
vi.mock("@/src/server/evaluators/typesafe", () => ({ evaluateListing: mocks.evaluateListing }));
vi.mock("@/src/server/evaluators/typesafe/questions", () => ({ QUESTIONS_VERSION: "questions-test" }));
vi.mock("@/src/server/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/src/server/db/schema", () => ({ assessments: { listingId: "listing_id", inputFingerprint: "input_fingerprint" } }));
vi.mock("@/src/server/db/client", () => ({ getDatabase: () => ({ db: { insert: () => ({ values: (value: unknown) => mocks.upsert(value) }) } }) }));

import { POST } from "./route";

const listingId = "11111111-1111-4111-8111-111111111111";
const item = {
  listing: {
    id: listingId, externalId: "item-1", platform: "xianyu", category: "watch", brand: "劳力士", title: "腕表",
    description: "闲置腕表", price: 1000, region: "广州", publishedAt: "2026-09-23T00:00:00.000Z",
    firstSeenAt: "2026-09-23T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0,
    hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false, monitorKeywords: ["劳力士"],
    seller: { externalId: "seller-1", displayName: "卖家", region: "广州", activeListingCount: 6, sameCategoryCount: 6, sameCategoryRatio: 1, signalScope: "observed-listings", templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
  },
  assessment: {},
};
const assessment = {
  listingId, rulesetVersion: "rules-test", riskLevel: "insufficient", recommendedAction: "review",
  scores: { categoryMatch: 80, personalSeller: 20, authenticityRisk: 10, informationCompleteness: 20, profitOpportunity: 50, recency: 80, totalOpportunity: 40 },
  evidence: [], missingInformation: [], suggestedQuestions: [], summary: "规则结果", evaluatedAt: "2026-09-23T00:00:00.000Z",
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
    mocks.assessListing.mockReturnValue(assessment);
    mocks.evaluateListing.mockResolvedValue(null);
    mocks.getServerEnv.mockReturnValue({ TYPESAFE_ENABLED: "false", TYPESAFE_CONFIDENCE_THRESHOLD: 55 });
    mocks.upsert.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
  });

  it("re-evaluates and persists the score in place", async () => {
    const response = await POST(request({ listingId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, jevEvaluated: false, totalOpportunity: 40 });
    expect(mocks.evaluateListing).toHaveBeenCalledWith(item.listing, assessment, { mode: "manual", sellerRuleThresholds: { sameCategoryMinCount: 6, completedSaleMinCount: 100 } });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ listingId, inputFingerprint: expect.any(String), totalOpportunity: 40 }));
  });

  it("rejects malformed listing IDs before querying data", async () => {
    const response = await POST(request({ listingId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(mocks.loadLatestAssessedListings).not.toHaveBeenCalled();
  });
});
