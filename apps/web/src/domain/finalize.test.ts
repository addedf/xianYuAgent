import { describe, expect, it } from "vitest";
import type { MarketplaceListing } from "./listing";
import type { JevEvaluation } from "./jev";
import type { RuleFacts } from "./facts";
import { buildRuleFacts } from "./facts";
import type { PreFilterHit } from "./pre-filters";
import { calculateTotalOpportunity, determineAction, determineRiskLevel, finalizeAssessment, filteredAssessment, pendingAssessment, RULESET_VERSION } from "./finalize";

const listing: MarketplaceListing = {
  id: "l-1", externalId: "e-1", platform: "xianyu", category: "watch", brand: "劳力士", model: "日志型",
  title: "自用劳力士日志型", description: "自用几年，保卡齐全", price: 60000, marketReferencePrice: 70000,
  region: "广州", publishedAt: "2026-09-24T09:00:00.000Z", firstSeenAt: "2026-09-24T09:01:00.000Z",
  imageUrls: [], duplicateImageCount: 0, hasSerialDetail: true, hasPurchaseProof: true, hasAccessoryDescription: true,
  monitorKeywords: ["劳力士"],
  seller: { externalId: "s-1", displayName: "林小姐", region: "广州", activeListingCount: 2, sameCategoryRatio: 0.5, templateSimilarity: 0.1, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
};
const facts: RuleFacts = buildRuleFacts(listing, new Date("2026-09-24T10:00:00.000Z"));

function jevFixture(overrides: {
  personalSeller?: number; authenticityRisk?: number; completeness?: number;
  personalConfidence?: number; riskConfidence?: number; completenessConfidence?: number;
} = {}): JevEvaluation {
  const personalSeller = overrides.personalSeller ?? 85;
  const authenticityRisk = overrides.authenticityRisk ?? 20;
  const completeness = overrides.completeness ?? 70;
  const personalConfidence = overrides.personalConfidence ?? 0.9;
  const riskConfidence = overrides.riskConfidence ?? 0.85;
  const completenessConfidence = overrides.completenessConfidence ?? 0.8;
  return {
    modelVersion: "jev-test", questionsVersion: "q-test", stateFingerprint: "state-fp",
    scores: {
      personalSeller: { score: personalSeller, confidence: personalConfidence, probabilities: {}, signal: "s" },
      authenticityRisk: { score: authenticityRisk, confidence: riskConfidence, probabilities: {}, signal: "s" },
      informationCompleteness: { score: completeness, confidence: completenessConfidence, probabilities: {}, signal: "s" },
    },
    sellerType: { choice: "personal", confidence: 0.9, probabilities: {} },
    counterfeitClaim: 0.05, personalStory: 0.9, raw: {},
  };
}

describe("calculateTotalOpportunity", () => {
  it("keeps the documented weight structure", () => {
    const total = calculateTotalOpportunity({
      categoryMatch: 100, personalSeller: 100, authenticityRisk: 0, informationCompleteness: 100, profitOpportunity: 100, recency: 100,
    });
    expect(total).toBe(100);
    const total2 = calculateTotalOpportunity({
      categoryMatch: 0, personalSeller: 100, authenticityRisk: 100, informationCompleteness: 0, profitOpportunity: 0, recency: 0,
    });
    // personalSeller 30 + (100-100)*30% = 30。
    expect(total2).toBe(30);
  });
});

describe("determineRiskLevel / determineAction", () => {
  it("follows the documented thresholds", () => {
    expect(determineRiskLevel(80, 60)).toBe("high");
    expect(determineRiskLevel(30, 50)).toBe("insufficient");
    expect(determineRiskLevel(40, 60)).toBe("medium");
    expect(determineRiskLevel(20, 70)).toBe("low");
    expect(determineAction(90, 20, 80, 85)).toBe("notify");
    expect(determineAction(90, 40, 80, 85)).toBe("review");
    expect(determineAction(90, 80, 80, 85)).toBe("skip");
    expect(determineAction(90, 20, 80, 10)).toBe("skip");
    expect(determineAction(50, 20, 80, 85)).toBe("archive");
  });
});

describe("finalizeAssessment", () => {
  it("adopts JEV dimensions directly and keeps hard facts in the total", () => {
    const assessment = finalizeAssessment(listing, facts, jevFixture());
    expect(assessment.scores.personalSeller).toBe(85);
    expect(assessment.scores.authenticityRisk).toBe(20);
    expect(assessment.scores.informationCompleteness).toBe(70);
    expect(assessment.scores.categoryMatch).toBe(facts.hardFacts.categoryMatch);
    // 96*0.1 + 85*0.3 + 80*0.3 + 70*0.1 + profit*0.15 + 100*0.05。
    const expected = Math.round(facts.hardFacts.categoryMatch * 0.1 + 85 * 0.3 + (100 - 20) * 0.3 + 70 * 0.1 + facts.hardFacts.profitOpportunity * 0.15 + facts.hardFacts.recency * 0.05);
    expect(assessment.scores.totalOpportunity).toBe(expected);
    expect(assessment.modelVersion).toBe("jev-test");
    expect(assessment.rulesetVersion).toBe(RULESET_VERSION);
    // facts 证据行不携带权威分数影响。
    expect(assessment.evidence.every((row) => row.scoreImpact === 0)).toBe(true);
    expect(assessment.evidence.some((row) => row.code === "jev-personalSeller")).toBe(true);
  });

  it("caps confident-enough low actions when model confidence is below the threshold", () => {
    const lowConfidence = jevFixture({ personalConfidence: 0.3, riskConfidence: 0.3, completenessConfidence: 0.3 });
    const assessment = finalizeAssessment(listing, facts, lowConfidence, { confidenceThreshold: 55 });
    expect(assessment.modelReviewRequired).toBe(true);
    // 低置信度时不允许模型给出 skip/notify。
    expect(["notify", "skip"]).not.toContain(assessment.recommendedAction);

    const confident = finalizeAssessment(listing, facts, jevFixture(), { confidenceThreshold: 55 });
    expect(confident.modelReviewRequired).toBe(false);
  });

  it("uses the default threshold when none is provided", () => {
    const assessment = finalizeAssessment(listing, facts, jevFixture({ personalConfidence: 0.2, riskConfidence: 0.2, completenessConfidence: 0.2 }));
    // (0.2*0.4 + 0.2*0.4 + 0.2*0.2) * 100 = 20 < 55。
    expect(assessment.modelReviewRequired).toBe(true);
  });
});

describe("pendingAssessment / filteredAssessment", () => {
  it("builds a pending placeholder that is never persisted", () => {
    const pending = pendingAssessment(listing);
    expect(pending.pending).toBe(true);
    expect(pending.riskLevel).toBe("insufficient");
    expect(pending.recommendedAction).toBe("review");
    expect(pending.scores.totalOpportunity).toBe(0);
    expect(pending.evidence[0]?.code).toBe("jev-pending");
    expect(pending.modelVersion).toBeUndefined();
  });

  it("builds a filtered record with the filter code and reason", () => {
    const hit: PreFilterHit = { code: "listing-counterfeit-terms", source: "rule", riskLevel: "high", label: "高仿词硬阻断", detail: "命中：复刻。" };
    const filtered = filteredAssessment(listing, hit);
    expect(filtered.filterCode).toBe("listing-counterfeit-terms");
    expect(filtered.recommendedAction).toBe("skip");
    expect(filtered.riskLevel).toBe("high");
    expect(filtered.scores.totalOpportunity).toBe(0);
    expect(filtered.evidence).toHaveLength(1);
    expect(filtered.evidence[0]?.detail).toContain("复刻");
  });
});
