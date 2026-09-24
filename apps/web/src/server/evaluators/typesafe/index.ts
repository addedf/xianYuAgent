import type { JevEvaluation } from "@/src/domain/jev";
import type { MarketplaceListing, ListingAssessment } from "@/src/domain/listing";
import type { SellerRuleThresholds } from "@/src/domain/seller-rules";
import { getServerEnv, isDemoMode, type ServerEnv } from "@/src/server/env";
import { takeRateLimit } from "./rate-limit";
import { buildTypesafeState } from "./questions";
import { requestTypesafe } from "./client";
import { isJevControlEnabled } from "./control";

export async function evaluateListing(listing: MarketplaceListing, rule: ListingAssessment, options: {
  env?: ServerEnv; fetcher?: typeof fetch; controlEnabled?: () => Promise<boolean>; takeToken?: (limit: number) => boolean; mode?: "automatic" | "manual"; sellerRuleThresholds?: SellerRuleThresholds;
} = {}): Promise<JevEvaluation | null> {
  try {
    const env = options.env ?? getServerEnv();
    if (isDemoMode(env) || listing.platform === "demo" || env.TYPESAFE_ENABLED !== "true" || !env.TYPESAFE_API_KEY) return null;
    const inGrayZone = rule.scores.totalOpportunity >= 45 && rule.scores.totalOpportunity <= 65;
    if (options.mode !== "manual" && env.TYPESAFE_EVALUATION_SCOPE === "gray-zone" && !inGrayZone && rule.riskLevel !== "insufficient" && rule.riskLevel !== "medium") return null;
    if (!await (options.controlEnabled ?? isJevControlEnabled)()) return null;
    const takeToken = options.takeToken ?? takeRateLimit;
    const limit = env.TYPESAFE_RATE_LIMIT_PER_MIN ?? 30;
    if (options.mode === "manual") {
      while (!takeToken(limit)) await new Promise<void>((resolve) => setTimeout(resolve, 250));
    } else if (!takeToken(limit)) return null;
    return await requestTypesafe(buildTypesafeState(listing, rule, options.sellerRuleThresholds), env, options.fetcher);
  } catch {
    return null;
  }
}
