import { describe, expect, it } from "vitest";
import { parseTypesafeResponse } from "./client";
import { buildTypesafeState } from "./questions";

const listing = {
  id: "1", externalId: "1", platform: "xianyu" as const, category: "bag" as const, brand: "Chanel", title: "闲置包", description: "自用闲置", price: 1000, region: "广州", publishedAt: "2026-09-21T00:00:00.000Z", firstSeenAt: "2026-09-21T00:00:00.000Z", imageUrls: [], duplicateImageCount: 0, hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false, monitorKeywords: ["Chanel"], seller: { externalId: "seller", displayName: "匿名", region: "广州", activeListingCount: 2, sameCategoryRatio: 0.2, templateSimilarity: 0.1, hasPersonalStorySignals: true, hasNaturalSceneSignals: true },
};
const assessment = { listingId: "1", riskLevel: "low" as const, recommendedAction: "review" as const, scores: { categoryMatch: 90, personalSeller: 60, authenticityRisk: 20, informationCompleteness: 30, profitOpportunity: 50, recency: 80, totalOpportunity: 60 }, evidence: [], missingInformation: [], suggestedQuestions: [], summary: "", evaluatedAt: "2026-09-21T00:00:00.000Z", rulesetVersion: "v1" };
const response = {
  model: "jev-latest", answers: {
    personalSellerScore: { type: "score", score: 3, confidence: 0.8, probabilities: { "0": 0.01, "1": 0.04, "2": 0.1, "3": 0.7, "4": 0.15 }, legend: { "0": "明显批发、同行或职业铺货", "1": "模板化销售话术，没有具体使用背景", "2": "线索中性，缺少个人或职业卖家的充分证据", "3": "有具体购买使用背景、口语化表达、个人化定价", "4": "多项一致的个人经历与单一闲置品类信号" } },
    authenticityRiskScore: { type: "score", score: 1, confidence: 0.7, probabilities: { "0": 0.6, "1": 0.2, "2": 0.1, "3": 0.05, "4": 0.05 }, legend: { "0": "文案没有疑假信号；不代表已鉴定为真", "1": "仅轻微疑点，信息缺失本身不算假货证据", "2": "有价格异常、模板痕迹或来源模糊等多项疑点", "3": "回避鉴定、专柜同源或特殊渠道等强疑假话术", "4": "明确复刻、非正品或高度一致的疑假信号" } },
    completenessScore: { type: "score", score: 2, confidence: 0.6, probabilities: { "0": 0.1, "1": 0.2, "2": 0.5, "3": 0.15, "4": 0.05 }, legend: { "0": "只有标题或价格，缺少关键细节", "1": "少量基本描述和图片线索", "2": "部分编号、凭证、附件或成色说明", "3": "编号、凭证、附件、成色维修史与多角度实拍大多完整", "4": "上述维度均充分具体且互相一致" } },
    sellerType: { type: "choice", choice: "personal", confidence: 0.8, probabilities: { personal: 0.8, professional: 0.05, peer: 0.05, unclear: 0.1 } }, counterfeitClaim: { type: "noul", noul: 0.1 }, personalStory: { type: "noul", noul: 0.9 },
  }, usage: { input_tokens: 1, output_tokens: 1 },
};

describe("TypeSafe response adapter", () => {
  it("normalizes documented score/choice/noul answers", () => {
    const evaluation = parseTypesafeResponse(response, buildTypesafeState(listing, assessment));
    expect(evaluation?.scores.personalSeller.score).toBe(75);
    expect(evaluation?.scores.authenticityRisk.confidence).toBe(0.7);
    expect(evaluation?.sellerType.choice).toBe("personal");
  });

  it("rejects an altered rubric instead of trusting an unverified response", () => {
    const invalid = structuredClone(response);
    invalid.answers.personalSellerScore.legend["0"] = "别的说明";
    expect(parseTypesafeResponse(invalid, buildTypesafeState(listing, assessment))).toBeNull();
  });
});
