import { describe, expect, it, vi } from "vitest";
import { evaluateListing } from "./index";

const listing = { id: "1", externalId: "1", platform: "demo" as const, category: "bag" as const, brand: "Chanel", title: "包", description: "", price: 100, region: "广州", publishedAt: "2026-09-21T00:00:00.000Z", firstSeenAt: "2026-09-21T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false, monitorKeywords: ["包"], seller: { externalId: "s", displayName: "", region: "广州", activeListingCount: 1, sameCategoryRatio: 0, templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false } };
const rule = { listingId: "1", riskLevel: "insufficient" as const, recommendedAction: "review" as const, scores: { categoryMatch: 80, personalSeller: 50, authenticityRisk: 10, informationCompleteness: 20, profitOpportunity: 50, recency: 80, totalOpportunity: 50 }, evidence: [], missingInformation: [], suggestedQuestions: [], summary: "", evaluatedAt: "2026-09-21T00:00:00.000Z", rulesetVersion: "v1" };

describe("evaluateListing", () => {
  it("does not call any upstream when demo mode is active", async () => {
    const fetcher = vi.fn();
    const result = await evaluateListing(listing, rule, { env: { ...process.env, APP_DEMO_MODE: "true", DATABASE_URL: "", TYPESAFE_ENABLED: "true", TYPESAFE_API_KEY: "secret" } as never, fetcher });
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("manual rescoring bypasses only the gray-zone filter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
    await evaluateListing({ ...listing, platform: "xianyu" }, { ...rule, scores: { ...rule.scores, totalOpportunity: 85 } }, {
      env: { APP_DEMO_MODE: "false", DATABASE_URL: "postgres://local", TYPESAFE_ENABLED: "true", TYPESAFE_API_KEY: "placeholder", TYPESAFE_EVALUATION_SCOPE: "gray-zone", TYPESAFE_RATE_LIMIT_PER_MIN: 30 } as never,
      fetcher,
      controlEnabled: async () => true,
      takeToken: () => true,
      mode: "manual",
    });

    expect(fetcher).toHaveBeenCalled();
  });
});
