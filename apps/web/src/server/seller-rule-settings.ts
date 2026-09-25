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
  // 旧版本规则行没有 onSaleMinCount，回填代码默认值，保持既有自定义阈值不丢失。
  const rawOnSaleMinCount = record.onSaleMinCount === undefined ? DEFAULT_SELLER_RULE_THRESHOLDS.onSaleMinCount : record.onSaleMinCount;
  if (typeof rawOnSaleMinCount !== "number" || !Number.isSafeInteger(rawOnSaleMinCount)) return null;
  const onSaleMinCount = rawOnSaleMinCount;
  if (
    sameCategoryMinCount < 1 || sameCategoryMinCount > 10_000
    || completedSaleMinCount < 0 || completedSaleMinCount > 10_000_000
    || onSaleMinCount < 1 || onSaleMinCount > 1_000_000
  ) return null;
  return { sameCategoryMinCount, completedSaleMinCount, onSaleMinCount };
}

export async function loadSellerRuleSettings(): Promise<{ thresholds: SellerRuleThresholds; version: number; persisted: boolean; enabled: boolean }> {
  try {
    const { db } = getDatabase();
    const [definition] = await db.select({ id: ruleDefinitions.id, currentVersion: ruleDefinitions.currentVersion, enabled: ruleDefinitions.enabled })
      .from(ruleDefinitions).where(eq(ruleDefinitions.code, SELLER_RULE_CODE)).limit(1);
    if (!definition) return { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: 1, persisted: false, enabled: true };
    const [version] = await db.select({ conditions: ruleVersions.conditions, version: ruleVersions.version })
      .from(ruleVersions).where(and(eq(ruleVersions.ruleId, definition.id), eq(ruleVersions.version, definition.currentVersion))).limit(1);
    const thresholds = asThresholds(version?.conditions);
    return thresholds
      ? { thresholds, version: version.version, persisted: true, enabled: definition.enabled }
      : { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: definition.currentVersion, persisted: false, enabled: definition.enabled };
  } catch {
    return { thresholds: DEFAULT_SELLER_RULE_THRESHOLDS, version: 1, persisted: false, enabled: true };
  }
}

export { asThresholds as parseSellerRuleThresholds };
