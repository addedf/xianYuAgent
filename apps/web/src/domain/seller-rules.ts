export interface SellerRuleThresholds {
  sameCategoryMinCount: number;
  completedSaleMinCount: number;
}

export const DEFAULT_SELLER_RULE_THRESHOLDS: SellerRuleThresholds = {
  sameCategoryMinCount: 6,
  completedSaleMinCount: 100,
};
