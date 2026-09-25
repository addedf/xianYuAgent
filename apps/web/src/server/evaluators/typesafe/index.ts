import type { JevEvaluation } from "@/src/domain/jev";
import type { MarketplaceListing } from "@/src/domain/listing";
import type { RuleFacts } from "@/src/domain/facts";
import type { SellerRuleThresholds } from "@/src/domain/seller-rules";
import type { KnowledgeContext } from "@/src/domain/knowledge-context";
import { getServerEnv, isDemoMode, type ServerEnv } from "@/src/server/env";
import { takeRateLimit } from "./rate-limit";
import { buildTypesafeState } from "./questions";
import { requestTypesafe } from "./client";
import { isJevControlEnabled } from "./control";

// JEV 是唯一的判断评分来源；规则引擎只提供 facts。返回 null 表示本次没有产生
// 评分（未配置、总开关关闭、限频丢弃或上游异常），调用方应把线索保持待评分状态，
// 不写入任何规则兜底结果。
export async function evaluateListing(listing: MarketplaceListing, facts: RuleFacts, options: {
  env?: ServerEnv; fetcher?: typeof fetch; controlEnabled?: () => Promise<boolean>; takeToken?: (limit: number) => boolean; mode?: "automatic" | "manual"; sellerRuleThresholds?: SellerRuleThresholds | null; knowledge?: KnowledgeContext;
} = {}): Promise<JevEvaluation | null> {
  try {
    const env = options.env ?? getServerEnv();
    if (isDemoMode(env) || listing.platform === "demo" || env.TYPESAFE_ENABLED !== "true" || !env.TYPESAFE_API_KEY) return null;
    if (!await (options.controlEnabled ?? isJevControlEnabled)()) return null;
    const takeToken = options.takeToken ?? takeRateLimit;
    const limit = env.TYPESAFE_RATE_LIMIT_PER_MIN ?? 30;
    if (options.mode === "manual") {
      while (!takeToken(limit)) await new Promise<void>((resolve) => setTimeout(resolve, 250));
    } else if (!takeToken(limit)) return null;
    return await requestTypesafe(buildTypesafeState(listing, facts, options.sellerRuleThresholds, options.knowledge), env, options.fetcher);
  } catch {
    return null;
  }
}
