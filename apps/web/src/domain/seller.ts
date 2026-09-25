import type { Category, SellerProfile } from "./listing";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

export type SellerClassificationSignals = Pick<SellerProfile,
  "activeListingCount" | "sameCategoryRatio" | "sameCategoryCount" | "completedSaleCount" | "completedSaleCountVerified" | "onSaleCount" | "identityScope" | "signalScope" | "profileCategoryMix"
>;

const PROFILE_CATEGORY_PATTERNS: Partial<Record<Category, RegExp>> = {
  watch: /腕表|手表|钟表/,
  bag: /箱包|手袋|背包|女包|男包|钱包/,
  jewelry: /珠宝|首饰|饰品|项链|戒指|手链|耳饰/,
};

export function profileSameCategoryCount(category: Category, categoryMix?: Record<string, number>): number | undefined {
  const pattern = PROFILE_CATEGORY_PATTERNS[category];
  if (!pattern || !categoryMix || Object.keys(categoryMix).length === 0) return undefined;
  return Object.entries(categoryMix).reduce((count, [label, value]) =>
    count + (pattern.test(label) && Number.isSafeInteger(value) && value >= 0 ? value : 0), 0);
}

export function sameCategoryListingCount(seller: SellerClassificationSignals): number {
  return seller.sameCategoryCount ?? Math.round(seller.activeListingCount * seller.sameCategoryRatio);
}

export function nonPersonalSellerReason(seller: SellerClassificationSignals, thresholds: SellerRuleThresholds = DEFAULT_SELLER_RULE_THRESHOLDS, category?: Category): string | null {
  const sameCategoryCount = sameCategoryListingCount(seller);
  if (sameCategoryCount >= thresholds.sameCategoryMinCount) {
    const subject = seller.identityScope === "stable-platform-id"
      ? "同一平台账号的已采集记录"
      : seller.identityScope === "nickname-region" ? "同昵称+地区的已采集记录" : "当前匹配卖家键的已采集记录";
    return `${subject}中同品类商品 ${sameCategoryCount} 条`;
  }
  const homepageCount = category && seller.identityScope === "stable-platform-id" && seller.signalScope === "complete-profile"
    ? profileSameCategoryCount(category, seller.profileCategoryMix)
    : undefined;
  if (homepageCount !== undefined && homepageCount >= thresholds.sameCategoryMinCount) {
    return `卖家主页在售采样中同品类商品 ${homepageCount} 条`;
  }
  if (seller.onSaleCount !== undefined && seller.onSaleCount >= thresholds.onSaleMinCount) {
    return `卖家主页在售数量为 ${seller.onSaleCount} 件`;
  }
  if (seller.completedSaleCountVerified && seller.completedSaleCount !== undefined && seller.completedSaleCount > thresholds.completedSaleMinCount) {
    return `已核验的公开已售数量为 ${seller.completedSaleCount} 件`;
  }
  return null;
}
