import type { AssessmentEvidence, MarketplaceListing } from "./listing";

// 规则引擎只产出事实与信号，不再产出权威评分；所有判断打分由 JEV 完成。
// scoreImpact 语义变更：facts 证据行固定为 0（参考信号），不再参与分数合成。

export const COUNTERFEIT_TERMS = ["高仿", "复刻", "原单", "专柜品质", "顶级版本", "一比一"];
export const PERSONAL_TERMS = ["自用", "闲置", "朋友送", "结婚买的", "搬家", "急用钱", "不常戴"];
export const SERIAL_TERMS = ["序列号", "身份编码", "编码", "字头", "编号", "芯片", "NFC", "防伪码"];
export const PURCHASE_PROOF_TERMS = ["保卡", "票据", "发票", "购买凭证", "证书", "专柜购入", "柜台购入", "小票", "带票"];
export const ACCESSORY_TERMS = ["全套", "附件", "盒子", "包装", "表节", "维修", "保养记录", "肩带", "尘袋", "防尘袋", "配件"];
export const FACT_THRESHOLDS = { priceGapRatio: 0.18, templateSimilarity: 0.72, concentrationCount: 3, concentrationRatio: 0.75, minimumDescriptionLength: 35, minimumImageCount: 5 } as const;
export const FACT_SCORE_PARAMETERS = {
  categoryMatched: 96,
  categoryUnmatched: 68,
  profitBase: 40,
  profitMarginMultiplier: 90,
  profitWithoutReference: 45,
  recencyBands: [{ minutes: 10, score: 100 }, { minutes: 30, score: 88 }, { minutes: 120, score: 68 }, { minutes: 360, score: 45 }, { minutes: 1440, score: 24 }],
  recencyAfterBands: 8,
} as const;

export function containsAny(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase()));
}

function matchesSearchKeyword(text: string, keyword: string): boolean {
  const normalized = text.toLowerCase();
  const parts = keyword.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => normalized.includes(part));
}

export interface FactSignal {
  code: string;
  kind: AssessmentEvidence["kind"];
  label: string;
  detail: string;
  source: AssessmentEvidence["source"];
}

export interface RuleHardFacts {
  categoryMatch: number;
  profitOpportunity: number;
  recency: number;
  priceVsReference: number | null;
  imageCount: number;
  descriptionLength: number;
  hasSerialDetail: boolean;
  hasPurchaseProof: boolean;
  hasAccessoryDescription: boolean;
}

export interface RuleFacts {
  issues: FactSignal[];
  positives: FactSignal[];
  missing: string[];
  suggestedQuestions: string[];
  hardFacts: RuleHardFacts;
}

export function suggestedQuestionsFromMissing(missing: string[]): string[] {
  return missing.slice(0, 3).map((item) => `方便补充${item}吗？`);
}

function calculateProfitOpportunity(listing: MarketplaceListing): number {
  if (!listing.marketReferencePrice || listing.marketReferencePrice <= 0) return FACT_SCORE_PARAMETERS.profitWithoutReference;
  const marginRatio = (listing.marketReferencePrice - listing.price) / listing.marketReferencePrice;
  return Math.max(0, Math.min(100, Math.round(FACT_SCORE_PARAMETERS.profitBase + marginRatio * FACT_SCORE_PARAMETERS.profitMarginMultiplier)));
}

export function calculateRecency(publishedAt: string, now: Date): number {
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return 0;
  const minutes = Math.max(0, (now.getTime() - published) / 60_000);
  for (const band of FACT_SCORE_PARAMETERS.recencyBands) if (minutes <= band.minutes) return band.score;
  return FACT_SCORE_PARAMETERS.recencyAfterBands;
}

export function buildRuleFacts(listing: MarketplaceListing, now = new Date()): RuleFacts {
  const issues: FactSignal[] = [];
  const positives: FactSignal[] = [];
  const missing: string[] = [];
  const text = `${listing.title} ${listing.description}`;
  const searchText = `${listing.brand} ${listing.model ?? ""} ${listing.title}`;

  const counterfeitHits = containsAny(text, COUNTERFEIT_TERMS);
  if (counterfeitHits.length > 0) {
    issues.push({
      code: "listing-suspicious-terms",
      kind: "risk",
      label: "命中明显高风险用语",
      detail: `命中：${counterfeitHits.join("、")}。`,
      source: "rule",
    });
  }

  const priceVsReference = listing.marketReferencePrice && listing.marketReferencePrice > 0 ? listing.price / listing.marketReferencePrice : null;
  if (priceVsReference !== null && priceVsReference < FACT_THRESHOLDS.priceGapRatio) {
    issues.push({
      code: "listing-extreme-price-gap",
      kind: "risk",
      label: "价格显著偏离市场区间",
      detail: `挂牌价约为参考价的 ${Math.round(priceVsReference * 100)}%。`,
      source: "market",
    });
  }

  if (listing.duplicateImageCount > 0) {
    issues.push({
      code: "listing-duplicate-images",
      kind: "risk",
      label: "发现重复图片",
      detail: `有 ${listing.duplicateImageCount} 张图片与历史商品重复。`,
      source: "rule",
    });
  }

  const seller = listing.seller;
  if (seller.templateSimilarity >= FACT_THRESHOLDS.templateSimilarity) {
    issues.push({
      code: "seller-template-copy",
      kind: "risk",
      label: "文案模板化明显",
      detail: `历史文案相似度约 ${Math.round(seller.templateSimilarity * 100)}%。`,
      source: "seller",
    });
  }
  if (seller.activeListingCount >= FACT_THRESHOLDS.concentrationCount && seller.sameCategoryRatio >= FACT_THRESHOLDS.concentrationRatio) {
    issues.push({
      code: "seller-category-concentration",
      kind: "risk",
      label: "同类商品高度集中",
      detail: `已入库的活跃商品中同品类占比约 ${Math.round(seller.sameCategoryRatio * 100)}%（当前为观察信号，不等同于完整主页统计）。`,
      source: "seller",
    });
  }

  const personalTerms = containsAny(text, PERSONAL_TERMS);
  if (seller.hasPersonalStorySignals || personalTerms.length > 0) {
    positives.push({
      code: "seller-personal-story",
      kind: "positive",
      label: "存在具体个人使用叙述",
      detail: personalTerms.length > 0 ? `命中：${personalTerms.join("、")}。` : "描述包含具体使用与闲置背景。",
      source: "seller",
    });
  }
  if (seller.hasNaturalSceneSignals) {
    positives.push({
      code: "seller-natural-scene",
      kind: "positive",
      label: "图片环境更像个人实拍",
      detail: "背景与拍摄方式呈现自然生活场景。",
      source: "seller",
    });
  }

  const hasDetailedText = text.trim().length >= FACT_THRESHOLDS.minimumDescriptionLength;
  const hasSerialDetail = listing.hasSerialDetail || containsAny(text, SERIAL_TERMS).length > 0;
  const hasPurchaseProof = listing.hasPurchaseProof || containsAny(text, PURCHASE_PROOF_TERMS).length > 0;
  const hasAccessoryDescription = listing.hasAccessoryDescription || containsAny(text, ACCESSORY_TERMS).length > 0;

  if (!hasDetailedText) missing.push("更完整的购买与使用说明");
  if (listing.imageUrls.length < FACT_THRESHOLDS.minimumImageCount) missing.push("关键细节多角度图片");
  if (!hasSerialDetail) missing.push("序列号或身份编码细节");
  if (!hasPurchaseProof) missing.push("购买凭证或来源证明");
  if (!hasAccessoryDescription) missing.push("附件、包装与维修史说明");

  if (hasPurchaseProof && hasSerialDetail) {
    positives.push({
      code: "listing-proof-and-serial",
      kind: "positive",
      label: "票据与编号信息较完整",
      detail: "已描述购买凭证与序列细节，仍需人工核对一致性。",
      source: "knowledge",
    });
  }

  return {
    issues,
    positives,
    missing,
    suggestedQuestions: suggestedQuestionsFromMissing(missing),
    hardFacts: {
      categoryMatch: listing.monitorKeywords.some((keyword) => matchesSearchKeyword(searchText, keyword)) ? FACT_SCORE_PARAMETERS.categoryMatched : FACT_SCORE_PARAMETERS.categoryUnmatched,
      profitOpportunity: calculateProfitOpportunity(listing),
      recency: calculateRecency(listing.publishedAt, now),
      priceVsReference,
      imageCount: listing.imageUrls.length,
      descriptionLength: text.trim().length,
      hasSerialDetail,
      hasPurchaseProof,
      hasAccessoryDescription,
    },
  };
}
