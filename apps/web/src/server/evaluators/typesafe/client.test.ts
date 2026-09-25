import { describe, expect, it } from "vitest";
import type { RuleFacts } from "@/src/domain/facts";
import { parseTypesafeResponse } from "./client";
import { buildTypesafeState, scoreRubrics } from "./questions";

const listing = {
  id: "1", externalId: "1", platform: "xianyu" as const, category: "bag" as const, brand: "Chanel", title: "闲置包", description: "自用闲置", price: 1000, region: "广州", publishedAt: "2026-09-21T00:00:00.000Z", firstSeenAt: "2026-09-21T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false, monitorKeywords: ["Chanel"], seller: { externalId: "seller", displayName: "匿名", region: "广州", activeListingCount: 2, sameCategoryRatio: 0.2, templateSimilarity: 0.1, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
};
const facts: RuleFacts = {
  issues: [],
  positives: [{ code: "seller-personal-story", kind: "positive", label: "存在具体个人使用叙述", detail: "命中：自用、闲置。", source: "seller" }],
  missing: ["购买凭证或来源证明"],
  suggestedQuestions: ["方便补充购买凭证或来源证明吗？"],
  hardFacts: { categoryMatch: 96, profitOpportunity: 60, recency: 80, priceVsReference: 0.7, imageCount: 0, descriptionLength: 4, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false },
};
const response = {
  model: "jev-latest", answers: {
    personalSellerScore: { type: "score", score: 3, confidence: 0.8, probabilities: { "0": 0.01, "1": 0.04, "2": 0.1, "3": 0.7, "4": 0.15 }, legend: { ...Object.fromEntries(scoreRubrics.personalSellerScore.map((label, i) => [String(i), label])) } },
    authenticityRiskScore: { type: "score", score: 1, confidence: 0.7, probabilities: { "0": 0.6, "1": 0.2, "2": 0.1, "3": 0.05, "4": 0.05 }, legend: { ...Object.fromEntries(scoreRubrics.authenticityRiskScore.map((label, i) => [String(i), label])) } },
    completenessScore: { type: "score", score: 2, confidence: 0.6, probabilities: { "0": 0.1, "1": 0.2, "2": 0.5, "3": 0.15, "4": 0.05 }, legend: { ...Object.fromEntries(scoreRubrics.completenessScore.map((label, i) => [String(i), label])) } },
    sellerType: { type: "choice", choice: "personal", confidence: 0.8, probabilities: { personal: 0.8, professional: 0.05, peer: 0.05, unclear: 0.1 } }, counterfeitClaim: { type: "noul", noul: 0.1 }, personalStory: { type: "noul", noul: 0.9 },
  }, usage: { input_tokens: 1, output_tokens: 1 },
};

describe("TypeSafe response adapter", () => {
  it("normalizes score answers with the probability expectation instead of the raw level", () => {
    const evaluation = parseTypesafeResponse(response, buildTypesafeState(listing, facts));
    // 期望档位 = 0.04*1 + 0.1*2 + 0.7*3 + 0.15*4 = 2.94 → 2.94 / 4 * 100 ≈ 74；
    // 原始五档档位（score: 3）保留在 raw 供审计。
    expect(evaluation?.scores.personalSeller.score).toBe(74);
    expect(evaluation?.scores.personalSeller.signal).toBe(scoreRubrics.personalSellerScore[3]);
    // 0.2*1 + 0.1*2 + 0.05*3 + 0.05*4 = 0.75 → 19。
    expect(evaluation?.scores.authenticityRisk.score).toBe(19);
    expect(evaluation?.scores.authenticityRisk.confidence).toBe(0.7);
    expect(evaluation?.sellerType.choice).toBe("personal");
    expect(evaluation?.stateFingerprint).toEqual(expect.any(String));
  });

  it("rejects an altered rubric instead of trusting an unverified response", () => {
    const invalid = structuredClone(response);
    (invalid.answers.personalSellerScore.legend as Record<string, string>)["0"] = "别的说明";
    expect(parseTypesafeResponse(invalid, buildTypesafeState(listing, facts))).toBeNull();
  });
});
