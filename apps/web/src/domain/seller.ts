import type { SellerProfile } from "./listing";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

export type SellerClassificationSignals = Pick<SellerProfile,
  "activeListingCount" | "sameCategoryRatio" | "sameCategoryCount" | "completedSaleCount" | "completedSaleCountVerified" | "identityScope"
>;

export function sameCategoryListingCount(seller: SellerClassificationSignals): number {
  return seller.sameCategoryCount ?? Math.round(seller.activeListingCount * seller.sameCategoryRatio);
}

export function nonPersonalSellerReason(seller: SellerClassificationSignals, thresholds: SellerRuleThresholds = DEFAULT_SELLER_RULE_THRESHOLDS): string | null {
  const sameCategoryCount = sameCategoryListingCount(seller);
  if (sameCategoryCount >= thresholds.sameCategoryMinCount) {
    const subject = seller.identityScope === "stable-platform-id"
      ? "同一平台账号的已采集记录"
      : seller.identityScope === "nickname-region" ? "同昵称+地区的已采集记录" : "当前匹配卖家键的已采集记录";
    return `${subject}中同品类商品 ${sameCategoryCount} 条`;
  }
  if (seller.completedSaleCountVerified && seller.completedSaleCount !== undefined && seller.completedSaleCount > thresholds.completedSaleMinCount) {
    return `已核验的公开已售数量为 ${seller.completedSaleCount} 件`;
  }
  return null;
}
