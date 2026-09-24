import { describe, expect, it } from "vitest";
import { fuseAssessment } from "./fusion";
import type { JevEvaluation } from "./jev";
import type { ListingAssessment } from "./listing";

const rule: ListingAssessment = {
  listingId: "listing-1", riskLevel: "low", recommendedAction: "notify",
  scores: { categoryMatch: 96, personalSeller: 70, authenticityRisk: 10, informationCompleteness: 55, profitOpportunity: 70, recency: 80, totalOpportunity: 72 },
  evidence: [], missingInformation: [], suggestedQuestions: [], summary: "规则结果", evaluatedAt: "2026-09-21T00:00:00.000Z", rulesetVersion: "rules-v1",
};
const jev: JevEvaluation = {
  modelVersion: "jev-typesafe-test", questionsVersion: "test", stateFingerprint: "state-hash",
  scores: {
    personalSeller: { score: 20, confidence: 0.9, probabilities: { "0": 0.1, "1": 0.1, "2": 0.2, "3": 0.3, "4": 0.3 }, signal: "职业销售" },
    authenticityRisk: { score: 80, confidence: 0.9, probabilities: { "0": 0.1, "1": 0.1, "2": 0.2, "3": 0.3, "4": 0.3 }, signal: "疑假" },
    informationCompleteness: { score: 90, confidence: 0.9, probabilities: { "0": 0.1, "1": 0.1, "2": 0.2, "3": 0.3, "4": 0.3 }, signal: "完整" },
  }, sellerType: { choice: "professional", confidence: 0.9, probabilities: { personal: 0.1, professional: 0.7, peer: 0.1, unclear: 0.1 } }, counterfeitClaim: 0.8, personalStory: 0.1, raw: {},
};
describe("fuseAssessment", () => {
  it("uses JEV as the primary rubric scorer and recomputes the total", () => {
    const result = fuseAssessment(rule, jev);
    expect(result.scores.personalSeller).toBe(24);
    expect(result.scores.authenticityRisk).toBe(74);
    expect(result.scores.informationCompleteness).toBe(87);
    expect(result.evidence.some((item) => item.source === "model")).toBe(true);
  });
  it("keeps the rule hard block even when the model disagrees", () => {
    const blocked = { ...rule, evidence: [{ code: "listing-suspicious-terms", kind: "risk" as const, label: "高仿", detail: "", scoreImpact: 62, source: "rule" as const }] };
    const result = fuseAssessment(blocked, { ...jev, scores: { ...jev.scores, personalSeller: { ...jev.scores.personalSeller, score: 100 }, authenticityRisk: { ...jev.scores.authenticityRisk, score: 0 } } });
    expect(result.recommendedAction).toBe("skip");
    expect(result.riskLevel).toBe("high");
  });
  it("caps low confidence model-driven escalation at review", () => {
    const low = { ...jev, scores: Object.fromEntries(Object.entries(jev.scores).map(([key, value]) => [key, { ...value, confidence: 0.2 }])) as JevEvaluation["scores"] };
    const result = fuseAssessment(rule, low);
    expect(result.recommendedAction).toBe("review");
  });

  it("does not let JEV override a high-volume same-category seller signal", () => {
    const highPersonalModel = { ...jev, scores: { ...jev.scores, personalSeller: { ...jev.scores.personalSeller, score: 100 } } };
    const result = fuseAssessment(rule, highPersonalModel, 55, { activeListingCount: 6, sameCategoryCount: 6, sameCategoryRatio: 1, signalScope: "observed-listings" });

    expect(result.scores.personalSeller).toBeLessThanOrEqual(32);
    expect(result.scores.totalOpportunity).toBeLessThan(rule.scores.totalOpportunity);
    expect(result.evidence.some((item) => item.code === "seller-observed-volume-jev-cap")).toBe(true);
  });
});
