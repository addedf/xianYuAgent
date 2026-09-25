import type { AssessmentEvidence, MarketplaceListing } from "./listing";
import { COUNTERFEIT_TERMS, containsAny } from "./facts";
import { nonPersonalSellerReason } from "./seller";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

// 前置过滤器在调用 JEV 之前直接淘汰低质量线索，不消耗模型配额。
// 过滤配置纳入 rule_definitions / rule_versions 版本化治理（见 src/server/pre-filter-settings.ts），
// 数据库不可用时回退到这里的默认值。

export const COUNTERFEIT_TERMS_FILTER_CODE = "listing-counterfeit-terms";
export const EXTREME_PRICE_GAP_FILTER_CODE = "listing-extreme-price-gap";
export const SELLER_NON_PERSONAL_FILTER_CODE = "seller-non-personal-thresholds";

export interface PreFilterConfigs {
  counterfeitTerms: string[] | null;
  extremePriceRatio: number | null;
  sellerThresholds: SellerRuleThresholds | null;
}

export const DEFAULT_PRE_FILTER_CONFIGS: PreFilterConfigs = {
  counterfeitTerms: [...COUNTERFEIT_TERMS],
  extremePriceRatio: 0.18,
  sellerThresholds: DEFAULT_SELLER_RULE_THRESHOLDS,
};

export interface PreFilterHit {
  code: string;
  source: AssessmentEvidence["source"];
  riskLevel: "high" | "medium";
  label: string;
  detail: string;
}

export function runPreFilters(listing: MarketplaceListing, configs: PreFilterConfigs = DEFAULT_PRE_FILTER_CONFIGS): PreFilterHit | null {
  const text = `${listing.title} ${listing.description}`;

  const counterfeitHits = configs.counterfeitTerms ? containsAny(text, configs.counterfeitTerms) : [];
  if (counterfeitHits.length > 0) {
    return {
      code: COUNTERFEIT_TERMS_FILTER_CODE,
      source: "rule",
      riskLevel: "high",
      label: "高仿词硬阻断",
      detail: `命中：${counterfeitHits.join("、")}。该线索被前置过滤器拦截，未调用 JEV 评分；如属误判请在「已过滤」视图中人工纠正。`,
    };
  }

  if (configs.extremePriceRatio !== null && listing.marketReferencePrice && listing.marketReferencePrice > 0 && listing.price / listing.marketReferencePrice < configs.extremePriceRatio) {
    return {
      code: EXTREME_PRICE_GAP_FILTER_CODE,
      source: "market",
      riskLevel: "medium",
      label: "价格严重异常",
      detail: `挂牌价约为参考价的 ${Math.round((listing.price / listing.marketReferencePrice) * 100)}%（当前阈值为参考价的 ${Math.round(configs.extremePriceRatio * 100)}%）。这类线索偶有真实捡漏，被拦截的记录保留在「已过滤」视图中供人工复核。`,
    };
  }

  // 与原评分引擎保持同一观察口径：只在存在已采集观察信号时判定，采集观察不等同于完整主页统计。
  const signalObserved = listing.seller.signalScope === "observed-listings"
    || listing.seller.signalScope === "complete-profile"
    || listing.seller.activeListingCount > 0;
  const nonPersonalReason = signalObserved && configs.sellerThresholds ? nonPersonalSellerReason(listing.seller, configs.sellerThresholds, listing.category) : null;
  if (nonPersonalReason) {
    return {
      code: SELLER_NON_PERSONAL_FILTER_CODE,
      source: "seller",
      riskLevel: "medium",
      label: "疑似非个人卖家",
      detail: `${nonPersonalReason}。这是职业销售风险信号，达到当前人工维护阈值后不再消耗 JEV 评分配额；如属误判请在「已过滤」视图中人工纠正。`,
    };
  }

  return null;
}
