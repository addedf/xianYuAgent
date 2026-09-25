import { describe, expect, it, vi } from "vitest";
import type { RuleFacts } from "@/src/domain/facts";
import type { ServerEnv } from "@/src/server/env";
import { evaluateListing } from "./index";

const listing = { id: "1", externalId: "1", platform: "demo" as const, category: "bag" as const, brand: "Chanel", title: "包", description: "", price: 100, region: "广州", publishedAt: "2026-09-21T00:00:00.000Z", firstSeenAt: "2026-09-21T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false, monitorKeywords: ["包"], seller: { externalId: "s", displayName: "", region: "广州", activeListingCount: 1, sameCategoryRatio: 0, templateSimilarity: 0, hasPersonalStorySignals: false, hasNaturalSceneSignals: false } };
const facts: RuleFacts = {
  issues: [], positives: [], missing: [], suggestedQuestions: [],
  hardFacts: { categoryMatch: 80, profitOpportunity: 50, recency: 80, priceVsReference: 0.8, imageCount: 0, descriptionLength: 1, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false },
};
const baseEnv = { APP_DEMO_MODE: "false", DATABASE_URL: "postgres://local", TYPESAFE_ENABLED: "true", TYPESAFE_API_KEY: "placeholder", TYPESAFE_RATE_LIMIT_PER_MIN: 30 } as unknown as ServerEnv;

describe("evaluateListing", () => {
  it("does not call any upstream when demo mode is active", async () => {
    const fetcher = vi.fn();
    const result = await evaluateListing(listing, facts, { env: { ...baseEnv, APP_DEMO_MODE: "true" } as never, fetcher });
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null without upstream calls when the control switch is disabled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await evaluateListing({ ...listing, platform: "xianyu" }, facts, {
      env: baseEnv, fetcher, controlEnabled: async () => false, takeToken: () => true,
    });
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops the request silently when automatic mode is rate limited", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await evaluateListing({ ...listing, platform: "xianyu" }, facts, {
      env: baseEnv, fetcher, controlEnabled: async () => true, takeToken: () => false,
    });
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("manual mode keeps waiting for a token and then reaches upstream", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
    let tokens = 0;
    await evaluateListing({ ...listing, platform: "xianyu" }, facts, {
      env: baseEnv, fetcher, controlEnabled: async () => true, takeToken: () => (tokens += 1) > 1, mode: "manual",
    });
    // 上游 503 会被适配层吞掉并返回 null（调用方保持待评分），但请求确实发出去了。
    expect(tokens).toBeGreaterThan(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
