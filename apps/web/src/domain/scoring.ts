import type {
  AssessmentEvidence,
  ListingAssessment,
  MarketplaceListing,
  RecommendedAction,
  RiskLevel,
} from "./listing";

export const RULESET_VERSION = "2026.08.30-v1";

const SUSPICIOUS_TERMS = ["高仿", "复刻", "原单", "专柜品质", "顶级版本", "一比一"];
const PERSONAL_TERMS = ["自用", "闲置", "朋友送", "结婚买的", "搬家", "急用钱", "不常戴"];

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function containsAny(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase()));
}

function calculatePersonalSeller(listing: MarketplaceListing, evidence: AssessmentEvidence[]): number {
  const { seller } = listing;
  let score = 58;

  if (seller.activeListingCount <= 5) {
    score += 14;
    evidence.push({
      code: "seller-low-volume",
      kind: "positive",
      label: "发布数量接近个人用户",
      detail: `当前活跃发布 ${seller.activeListingCount} 条。`,
      scoreImpact: 14,
      source: "seller",
    });
  } else if (seller.activeListingCount >= 20) {
    score -= 28;
    evidence.push({
      code: "seller-high-volume",
      kind: "risk",
      label: "发布数量偏高",
      detail: `当前活跃发布 ${seller.activeListingCount} 条，需要重点排查职业卖家。`,
      scoreImpact: -28,
      source: "seller",
    });
  }

  if (seller.sameCategoryRatio >= 0.75) {
    score -= 22;
    evidence.push({
      code: "seller-category-concentration",
      kind: "risk",
      label: "同类商品高度集中",
      detail: `同品类占比约 ${Math.round(seller.sameCategoryRatio * 100)}%。`,
      scoreImpact: -22,
      source: "seller",
    });
  }

  if (seller.templateSimilarity >= 0.72) {
    score -= 20;
    evidence.push({
      code: "seller-template-copy",
      kind: "risk",
      label: "文案模板化明显",
      detail: `历史文案相似度约 ${Math.round(seller.templateSimilarity * 100)}%。`,
      scoreImpact: -20,
      source: "seller",
    });
  }

  const personalTerms = containsAny(`${listing.title} ${listing.description}`, PERSONAL_TERMS);
  if (seller.hasPersonalStorySignals || personalTerms.length > 0) {
    score += 17;
    evidence.push({
      code: "seller-personal-story",
      kind: "positive",
      label: "存在具体个人使用叙述",
      detail: personalTerms.length > 0 ? `命中：${personalTerms.join("、")}。` : "描述包含具体使用与闲置背景。",
      scoreImpact: 17,
      source: "seller",
    });
  }

  if (seller.hasNaturalSceneSignals) {
    score += 11;
    evidence.push({
      code: "seller-natural-scene",
      kind: "positive",
      label: "图片环境更像个人实拍",
      detail: "背景与拍摄方式呈现自然生活场景。",
      scoreImpact: 11,
      source: "seller",
    });
  }

  return clamp(score);
}

function calculateAuthenticityRisk(listing: MarketplaceListing, evidence: AssessmentEvidence[]): number {
  let risk = 12;
  const text = `${listing.title} ${listing.description}`;
  const suspiciousTerms = containsAny(text, SUSPICIOUS_TERMS);

  if (suspiciousTerms.length > 0) {
    risk += 62;
    evidence.push({
      code: "listing-suspicious-terms",
      kind: "risk",
      label: "命中明显高风险用语",
      detail: `命中：${suspiciousTerms.join("、")}。`,
      scoreImpact: 62,
      source: "rule",
    });
  }

  if (listing.marketReferencePrice && listing.price / listing.marketReferencePrice < 0.18) {
    risk += 24;
    evidence.push({
      code: "listing-extreme-price-gap",
      kind: "risk",
      label: "价格显著偏离市场区间",
      detail: `挂牌价约为参考价的 ${Math.round((listing.price / listing.marketReferencePrice) * 100)}%。`,
      scoreImpact: 24,
      source: "market",
    });
  }

  if (listing.duplicateImageCount > 0) {
    const impact = Math.min(24, listing.duplicateImageCount * 8);
    risk += impact;
    evidence.push({
      code: "listing-duplicate-images",
      kind: "risk",
      label: "发现重复图片",
      detail: `有 ${listing.duplicateImageCount} 张图片与历史商品重复。`,
      scoreImpact: impact,
      source: "rule",
    });
  }

  if (listing.hasPurchaseProof && listing.hasSerialDetail) {
    risk -= 8;
    evidence.push({
      code: "listing-proof-and-serial",
      kind: "positive",
      label: "票据与编号信息较完整",
      detail: "已描述购买凭证与序列细节，仍需人工核对一致性。",
      scoreImpact: -8,
      source: "knowledge",
    });
  }

  return clamp(risk);
}

function calculateInformationCompleteness(
  listing: MarketplaceListing,
  evidence: AssessmentEvidence[],
  missingInformation: string[],
): number {
  let score = 18;

  if (listing.description.trim().length >= 35) score += 18;
  else missingInformation.push("更完整的购买与使用说明");

  if (listing.imageUrls.length >= 5) score += 18;
  else missingInformation.push("关键细节多角度图片");

  if (listing.hasSerialDetail) score += 18;
  else missingInformation.push("序列号或身份编码细节");

  if (listing.hasPurchaseProof) score += 14;
  else missingInformation.push("购买凭证或来源证明");

  if (listing.hasAccessoryDescription) score += 14;
  else missingInformation.push("附件、包装与维修史说明");

  if (missingInformation.length > 0) {
    evidence.push({
      code: "listing-missing-information",
      kind: "missing",
      label: "关键信息仍不完整",
      detail: `建议补充：${missingInformation.join("、")}。`,
      scoreImpact: score - 100,
      source: "knowledge",
    });
  }

  return clamp(score);
}

function calculateProfitOpportunity(listing: MarketplaceListing): number {
  if (!listing.marketReferencePrice || listing.marketReferencePrice <= 0) return 45;
  const marginRatio = (listing.marketReferencePrice - listing.price) / listing.marketReferencePrice;
  return clamp(40 + marginRatio * 90);
}

function calculateRecency(publishedAt: string, now: Date): number {
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return 0;
  const minutes = Math.max(0, (now.getTime() - published) / 60_000);
  if (minutes <= 10) return 100;
  if (minutes <= 30) return 88;
  if (minutes <= 120) return 68;
  if (minutes <= 360) return 45;
  if (minutes <= 1440) return 24;
  return 8;
}

function determineRiskLevel(risk: number, completeness: number): RiskLevel {
  if (risk >= 70) return "high";
  if (completeness < 58) return "insufficient";
  if (risk >= 36) return "medium";
  return "low";
}

function determineAction(total: number, risk: number, completeness: number, personalSeller: number): RecommendedAction {
  if (risk >= 70 || personalSeller < 20) return "skip";
  if (risk >= 36 || completeness < 58) return "review";
  if (total >= 65) return "notify";
  return "archive";
}

export function assessListing(listing: MarketplaceListing, now = new Date()): ListingAssessment {
  const evidence: AssessmentEvidence[] = [];
  const missingInformation: string[] = [];
  const searchText = `${listing.brand} ${listing.model ?? ""} ${listing.title}`;
  const categoryMatch = containsAny(searchText, listing.monitorKeywords).length > 0 ? 96 : 68;
  const personalSeller = calculatePersonalSeller(listing, evidence);
  const authenticityRisk = calculateAuthenticityRisk(listing, evidence);
  const informationCompleteness = calculateInformationCompleteness(listing, evidence, missingInformation);
  const profitOpportunity = calculateProfitOpportunity(listing);
  const recency = calculateRecency(listing.publishedAt, now);
  const totalOpportunity = clamp(
    categoryMatch * 0.2 +
      personalSeller * 0.25 +
      (100 - authenticityRisk) * 0.25 +
      profitOpportunity * 0.2 +
      recency * 0.1,
  );
  const riskLevel = determineRiskLevel(authenticityRisk, informationCompleteness);
  const recommendedAction = determineAction(totalOpportunity, authenticityRisk, informationCompleteness, personalSeller);
  const suggestedQuestions = missingInformation.slice(0, 3).map((item) => `方便补充${item}吗？`);

  const summary =
    recommendedAction === "notify"
      ? "个人卖家信号与价格空间较好，建议尽快人工查看并决定是否询价。"
      : recommendedAction === "review"
        ? "存在信息缺口或中等风险，建议先补图和核对来源。"
        : recommendedAction === "skip"
          ? "命中高风险或职业卖家信号，默认不主动联系。"
          : "机会分暂未达到提醒阈值，保留记录用于后续校准。";

  return {
    listingId: listing.id,
    riskLevel,
    recommendedAction,
    scores: {
      categoryMatch,
      personalSeller,
      authenticityRisk,
      informationCompleteness,
      profitOpportunity,
      recency,
      totalOpportunity,
    },
    evidence: evidence.sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact)),
    missingInformation,
    suggestedQuestions,
    summary,
    evaluatedAt: now.toISOString(),
    rulesetVersion: RULESET_VERSION,
  };
}

