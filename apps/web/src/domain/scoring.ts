import type {
  AssessmentEvidence,
  ListingAssessment,
  MarketplaceListing,
  RecommendedAction,
  RiskLevel,
} from "./listing";
import { nonPersonalSellerReason, sameCategoryListingCount } from "./seller";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

export const RULESET_VERSION = "2026.09.23-v4";

const SUSPICIOUS_TERMS = ["高仿", "复刻", "原单", "专柜品质", "顶级版本", "一比一"];
const PERSONAL_TERMS = ["自用", "闲置", "朋友送", "结婚买的", "搬家", "急用钱", "不常戴"];
const SERIAL_TERMS = ["序列号", "身份编码", "编码", "字头", "编号"];
const PURCHASE_PROOF_TERMS = ["保卡", "票据", "发票", "购买凭证", "证书", "专柜购入", "柜台购入"];
const ACCESSORY_TERMS = ["全套", "附件", "盒子", "包装", "表节", "维修", "保养记录"];

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function containsAny(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase()));
}

function calculatePersonalSeller(listing: MarketplaceListing, evidence: AssessmentEvidence[], sellerRuleThresholds: SellerRuleThresholds): number {
  const { seller } = listing;
  let score = 58;
  const signalObserved = seller.signalScope === "observed-listings" || seller.signalScope === "complete-profile" || seller.activeListingCount > 0;
  const concentrated = seller.activeListingCount >= 3 && seller.sameCategoryRatio >= 0.75;
  const nonPersonalReason = nonPersonalSellerReason(seller, sellerRuleThresholds);
  const sameCategoryCount = sameCategoryListingCount(seller);

  if (signalObserved && seller.signalScope === "complete-profile" && seller.activeListingCount <= 5 && !concentrated && !nonPersonalReason) {
    score += 14;
    evidence.push({
      code: "seller-low-volume",
      kind: "positive",
      label: "发布数量接近个人用户",
      detail: `已完整采集的卖家主页显示活跃发布 ${seller.activeListingCount} 条。`,
      scoreImpact: 14,
      source: "seller",
    });
  } else if (signalObserved && seller.signalScope === "observed-listings" && seller.activeListingCount <= 5 && !nonPersonalReason) {
    evidence.push({
      code: "seller-profile-incomplete",
      kind: "missing",
      label: "卖家主页信息未完整采集",
      detail: `目前仅观察到 ${seller.activeListingCount} 条已采集商品，无法据此判断卖家属于个人用户。`,
      scoreImpact: 0,
      source: "seller",
    });
  } else if (signalObserved && nonPersonalReason) {
    const penalty = seller.completedSaleCountVerified && (seller.completedSaleCount ?? 0) > 100 ? 24 : sameCategoryCount >= 20 ? 28 : sameCategoryCount >= 10 ? 20 : 16;
    score -= penalty;
    evidence.push({
      code: "seller-high-volume",
      kind: "risk",
      label: "疑似非个人卖家",
      detail: `${nonPersonalReason}。这是职业销售风险信号；采集到的商品范围不等同于完整主页统计。`,
      scoreImpact: -penalty,
      source: "seller",
    });
  }

  if (signalObserved && concentrated) {
    score -= 22;
    evidence.push({
      code: "seller-category-concentration",
      kind: "risk",
      label: "同类商品高度集中",
      detail: `已入库的活跃商品中同品类占比约 ${Math.round(seller.sameCategoryRatio * 100)}%（当前为观察信号，不等同于完整主页统计）。`,
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

  if (signalObserved && nonPersonalReason) {
    const cap = seller.completedSaleCountVerified && (seller.completedSaleCount ?? 0) > 100
      ? 24
      : sameCategoryCount >= 20
        ? 18
        : sameCategoryCount >= 10
          ? 24
          : 32;
    const beforeGuard = score;
    score = Math.min(score, cap);
    evidence.push({
      code: "seller-observed-volume-guard",
      kind: "risk",
      label: "非个人卖家规则限分",
      detail: `${nonPersonalReason}；个人卖家分上限为 ${cap}。观察范围受采集关键词和时间影响，不等同于完整主页。`,
      scoreImpact: score - beforeGuard,
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
  const text = `${listing.title} ${listing.description}`.trim();
  const hasDetailedText = text.length >= 35;
  const hasSerialDetail = listing.hasSerialDetail || containsAny(text, SERIAL_TERMS).length > 0;
  const hasPurchaseProof = listing.hasPurchaseProof || containsAny(text, PURCHASE_PROOF_TERMS).length > 0;
  const hasAccessoryDescription = listing.hasAccessoryDescription || containsAny(text, ACCESSORY_TERMS).length > 0;

  if (hasDetailedText) score += 18;
  else missingInformation.push("更完整的购买与使用说明");

  if (listing.imageUrls.length >= 5) score += 18;
  else missingInformation.push("关键细节多角度图片");

  if (hasSerialDetail) score += 18;
  else missingInformation.push("序列号或身份编码细节");

  if (hasPurchaseProof) score += 14;
  else missingInformation.push("购买凭证或来源证明");

  if (hasAccessoryDescription) score += 14;
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

export function determineRiskLevel(risk: number, completeness: number): RiskLevel {
  if (risk >= 70) return "high";
  if (completeness < 58) return "insufficient";
  if (risk >= 36) return "medium";
  return "low";
}

export function determineAction(total: number, risk: number, completeness: number, personalSeller: number): RecommendedAction {
  if (risk >= 70 || personalSeller < 20) return "skip";
  if (risk >= 36 || completeness < 58) return "review";
  if (total >= 65) return "notify";
  return "archive";
}

export function assessListing(listing: MarketplaceListing, now = new Date(), sellerRuleThresholds = DEFAULT_SELLER_RULE_THRESHOLDS): ListingAssessment {
  const evidence: AssessmentEvidence[] = [];
  const missingInformation: string[] = [];
  const searchText = `${listing.brand} ${listing.model ?? ""} ${listing.title}`;
  const categoryMatch = containsAny(searchText, listing.monitorKeywords).length > 0 ? 96 : 68;
  const personalSeller = calculatePersonalSeller(listing, evidence, sellerRuleThresholds);
  const authenticityRisk = calculateAuthenticityRisk(listing, evidence);
  const informationCompleteness = calculateInformationCompleteness(listing, evidence, missingInformation);
  const profitOpportunity = calculateProfitOpportunity(listing);
  const recency = calculateRecency(listing.publishedAt, now);
  const totalOpportunity = calculateTotalOpportunity({ categoryMatch, personalSeller, authenticityRisk, informationCompleteness, profitOpportunity, recency });
  const riskLevel = determineRiskLevel(authenticityRisk, informationCompleteness);
  const recommendedAction = evidence.some((item) => item.code === "listing-suspicious-terms")
    ? "skip" : determineAction(totalOpportunity, authenticityRisk, informationCompleteness, personalSeller);
  const suggestedQuestions = missingInformation.slice(0, 3).map((item) => `方便补充${item}吗？`);

  const summary = summarizeAction(recommendedAction);

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


export function summarizeAction(recommendedAction: RecommendedAction): string {
  return (
    recommendedAction === "notify"
      ? "个人卖家信号与价格空间较好，建议尽快人工查看并决定是否询价。"
      : recommendedAction === "review"
        ? "存在信息缺口或中等风险，建议先补图和核对来源。"
        : recommendedAction === "skip"
          ? "命中高风险或职业卖家信号，默认不主动联系。"
          : "机会分暂未达到提醒阈值，保留记录用于后续校准。"
  );
}

export function calculateTotalOpportunity(scores: Pick<import("./listing").AssessmentScores, "categoryMatch" | "personalSeller" | "authenticityRisk" | "informationCompleteness" | "profitOpportunity" | "recency">): number {
  // JEV's three rubric judgments form 70% of the opportunity score. The rule
  // engine contributes hard facts such as category fit, price spread, and age.
  return clamp(scores.categoryMatch * 0.1 + scores.personalSeller * 0.3 + (100 - scores.authenticityRisk) * 0.3 + scores.informationCompleteness * 0.1 + scores.profitOpportunity * 0.15 + scores.recency * 0.05);
}
