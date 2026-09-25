export interface SellerRuleThresholds {
  sameCategoryMinCount: number;
  completedSaleMinCount: number;
  /** 卖家主页在售件数阈值；主页数据来自平台只读抓取的头部统计。 */
  onSaleMinCount: number;
}

export const DEFAULT_SELLER_RULE_THRESHOLDS: SellerRuleThresholds = {
  sameCategoryMinCount: 6,
  completedSaleMinCount: 100,
  onSaleMinCount: 50,
};
