import type { Category } from "./listing";

/**
 * 卖家身份键治理（方案 4.2）：搜索列表层只有「昵称+地区」弱身份；
 * 平台稳定 ID 仅在详情补抓后可得。身份判断与排除策略分离：
 * 可以「身份未知但达到阈值而排除」，不能统一显示为「已证实商家」。
 */

export type SellerIdentityType = "stable" | "nickname-area" | "anonymous";

/** 平台在列表缺失昵称时的占位：对应大量真实卖家，不得整组拉黑或合并计数。 */
export const ANONYMOUS_PLACEHOLDER = "匿名卖家";

export const STRONG_IDENTITY_PREFIX = "xianyu-user-";

export function isAnonymousNickname(nickname: string | null | undefined): boolean {
  const value = (nickname ?? "").trim();
  return value.length === 0 || value === ANONYMOUS_PLACEHOLDER;
}

/** 弱身份键：与采集器 import_filter.seller_key 保持同一格式「昵称|地区」。 */
export function weakIdentityKey(displayName: string | null | undefined, region: string | null | undefined): string {
  return `${(displayName ?? "").trim()}|${(region ?? "").trim()}`;
}

/** 稳定身份键：与线索卖家 externalId 的稳定形态保持一致。 */
export function strongIdentityKey(platformSellerId: string): string {
  return `${STRONG_IDENTITY_PREFIX}${platformSellerId.trim()}`;
}

export interface SellerIdentityRef {
  displayName: string;
  region: string;
  /** 详情补抓得到的平台数字 ID（无则为空）。 */
  stableId?: string;
}

export interface SellerIdentityCandidate {
  key: string;
  type: SellerIdentityType;
}

/** 一个卖家在当前证据下的全部身份键：弱身份始终参与匹配，稳定 ID 存在时追加稳定键。 */
export function sellerIdentityCandidates(seller: SellerIdentityRef): SellerIdentityCandidate[] {
  const candidates: SellerIdentityCandidate[] = [];
  if (seller.stableId && seller.stableId.trim()) {
    candidates.push({ key: strongIdentityKey(seller.stableId), type: "stable" });
  }
  const weak = weakIdentityKey(seller.displayName, seller.region);
  const weakType: SellerIdentityType = isAnonymousNickname(seller.displayName) ? "anonymous" : "nickname-area";
  if (!candidates.some((candidate) => candidate.key === weak)) {
    candidates.push({ key: weak, type: weakType });
  }
  return candidates;
}

export function identityTypeLabel(type: string): string {
  if (type === "stable") return "平台稳定 ID";
  if (type === "anonymous") return "匿名占位";
  return "昵称+地区";
}

/** 排除原因的可读文案；与采集器 import_filter 的 reason 取值保持同集。 */
export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  "seller-frequency": "观察累计高频发布",
  "dup-title": "跨卖家重复标题（同行矩阵号信号）",
  "sold-count": "卖家已售件数超上限",
  "counterfeit-term": "标题命中高仿词",
  "merchant-name": "卖家名称疑似商家（人工巡查）",
  "manual-suspicion": "人工判断为商家",
};

export function exclusionReasonLabel(reason: string): string {
  return EXCLUSION_REASON_LABELS[reason] ?? reason;
}

/** 观察索引按卖家聚合后的证据视图（供工作台与自动排除使用）。 */
export interface SellerObservationEvidence {
  identityKey: string;
  distinctItemCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  categories: Array<Category | "unknown">;
  sampleTitles: string[];
}
