import { and, eq, inArray } from "drizzle-orm";
import {
  COUNTERFEIT_TERMS_FILTER_CODE,
  DEFAULT_PRE_FILTER_CONFIGS,
  EXTREME_PRICE_GAP_FILTER_CODE,
  type PreFilterConfigs,
} from "@/src/domain/pre-filters";
import { getDatabase } from "@/src/server/db/client";
import { ruleDefinitions, ruleVersions } from "@/src/server/db/schema";

// 前置过滤器配置沿用 seller-non-personal-thresholds 的治理方式：
// rule_definitions / rule_versions 版本化，读取失败或未配置时回退默认值。

function asTerms(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const terms = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 40);
  return terms.length > 0 && terms.length <= 50 ? terms : null;
}

function asPriceRatio(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

function asConditions(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function loadPreFilterSettings(): Promise<{ configs: PreFilterConfigs; persisted: boolean }> {
  const configs: PreFilterConfigs = {
    counterfeitTerms: [...DEFAULT_PRE_FILTER_CONFIGS.counterfeitTerms!],
    extremePriceRatio: DEFAULT_PRE_FILTER_CONFIGS.extremePriceRatio,
    sellerThresholds: { ...DEFAULT_PRE_FILTER_CONFIGS.sellerThresholds! },
  };
  try {
    const { db } = getDatabase();
    const definitions = await db.select({ id: ruleDefinitions.id, code: ruleDefinitions.code, currentVersion: ruleDefinitions.currentVersion, enabled: ruleDefinitions.enabled })
      .from(ruleDefinitions)
      .where(inArray(ruleDefinitions.code, [COUNTERFEIT_TERMS_FILTER_CODE, EXTREME_PRICE_GAP_FILTER_CODE]));
    let persisted = false;
    for (const definition of definitions) {
      if (!definition.enabled) {
        if (definition.code === COUNTERFEIT_TERMS_FILTER_CODE) configs.counterfeitTerms = null;
        if (definition.code === EXTREME_PRICE_GAP_FILTER_CODE) configs.extremePriceRatio = null;
        persisted = true;
        continue;
      }
      const [version] = await db.select({ conditions: ruleVersions.conditions })
        .from(ruleVersions)
        .where(and(eq(ruleVersions.ruleId, definition.id), eq(ruleVersions.version, definition.currentVersion)))
        .limit(1);
      const conditions = asConditions(version?.conditions);
      if (!conditions) continue;
      if (definition.code === COUNTERFEIT_TERMS_FILTER_CODE) {
        const terms = asTerms(conditions.terms);
        if (terms) {
          configs.counterfeitTerms = terms;
          persisted = true;
        }
      }
      if (definition.code === EXTREME_PRICE_GAP_FILTER_CODE) {
        const ratio = asPriceRatio(conditions.priceRatioBelow);
        if (ratio !== null) {
          configs.extremePriceRatio = ratio;
          persisted = true;
        }
      }
    }
    return { configs, persisted };
  } catch {
    return { configs, persisted: false };
  }
}
