import { and, eq } from "drizzle-orm";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "@/src/domain/seller-rules";
import { getDatabase } from "@/src/server/db/client";
import { ruleDefinitions, ruleVersions } from "@/src/server/db/schema";

export const SELLER_RULE_CODE = "seller-non-personal-thresholds";
export const SELLER_RULE_TITLE = "疑似非个人卖家判定阈值";

function asThresholds(value: unknown): SellerRuleThresholds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.sameCategoryMinCount) || !Number.isSafeInteger(record.completedSaleMinCount)) return null;
  const sameCategoryMinCount = record.sameCategoryMinCount as number;
  const completedSaleMinCount = record.completedSaleMinCount as number;
  if (sameCategoryMinCount < 1 || sameCategoryMinCount > 10_000 || completedSaleMinCount < 0 || completedSaleMinCount > 10_000_000) return null;
  return { sameCategoryMinCount, completedSaleMinCount };
}

export async function loadSellerRuleSettings(): Promise<{ thresholds: SellerRuleThresholds; version: number; persisted: boolean }> {
  try {
    const { db } = getDatabase();
    const [definition] = await db.select({ id: ruleDefinitions.id, currentVersion: ruleDefinitions.currentVersion })
      .from(ruleDefinitions).where(and(eq(ruleDefinitions.code, SELLER_RULE_CODE), eq(ruleDefinitions.enabled, true))).limit(1);
    if (!definition) return { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: 1, persisted: false };
    const [version] = await db.select({ conditions: ruleVersions.conditions, version: ruleVersions.version })
      .from(ruleVersions).where(and(eq(ruleVersions.ruleId, definition.id), eq(ruleVersions.version, definition.currentVersion))).limit(1);
    const thresholds = asThresholds(version?.conditions);
    return thresholds
      ? { thresholds, version: version.version, persisted: true }
      : { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: definition.currentVersion, persisted: false };
  } catch {
    return { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: 1, persisted: false };
  }
}

export { asThresholds as parseSellerRuleThresholds };
