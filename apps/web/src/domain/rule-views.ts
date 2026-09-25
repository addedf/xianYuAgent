import { COUNTERFEIT_TERMS_FILTER_CODE, DEFAULT_PRE_FILTER_CONFIGS, EXTREME_PRICE_GAP_FILTER_CODE, SELLER_NON_PERSONAL_FILTER_CODE } from "./pre-filters";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

// 知识库规则面板的展示模型：三个评分链路规则即使尚未入库，
// 也以代码默认值出现在「当前执行规则」中，保证全部生效规则可见。

export interface RuleVersionView {
  version: number;
  conditions?: unknown;
  changeReason: string;
  sourceType?: string;
  createdAt: string;
  approvedBy: string;
}

export interface KnowledgeRuleView {
  id: string;
  code: string;
  title: string;
  category: string;
  enabled: boolean;
  version: number;
  conditions: unknown;
  scoreImpact: number;
  explanation: string;
  changeReason: string;
  history: RuleVersionView[];
}

export const PIPELINE_RULE_CODES = [SELLER_NON_PERSONAL_FILTER_CODE, COUNTERFEIT_TERMS_FILTER_CODE, EXTREME_PRICE_GAP_FILTER_CODE];

export function defaultRuleViews(): KnowledgeRuleView[] {
  return [
    {
      id: `default-${SELLER_NON_PERSONAL_FILTER_CODE}`,
      code: SELLER_NON_PERSONAL_FILTER_CODE,
      title: "疑似非个人卖家判定阈值",
      category: "seller",
      enabled: true,
      version: 1,
      conditions: { ...DEFAULT_SELLER_RULE_THRESHOLDS },
      scoreImpact: -20,
      explanation: "达到任一阈值时标注疑似非个人卖家；前置过滤与 JEV 上下文都会使用。",
      changeReason: "系统默认阈值；保存后会记录为可追溯版本。",
      history: [],
    },
    {
      id: `default-${COUNTERFEIT_TERMS_FILTER_CODE}`,
      code: COUNTERFEIT_TERMS_FILTER_CODE,
      title: "高仿词前置过滤",
      category: "listing",
      enabled: true,
      version: 1,
      conditions: { terms: [...DEFAULT_PRE_FILTER_CONFIGS.counterfeitTerms!] },
      scoreImpact: 0,
      explanation: "标题或描述命中任一高仿词时，评分前直接拦截，不调用 JEV。",
      changeReason: "代码默认词表；保存新版本后以数据库为准。",
      history: [],
    },
    {
      id: `default-${EXTREME_PRICE_GAP_FILTER_CODE}`,
      code: EXTREME_PRICE_GAP_FILTER_CODE,
      title: "价格严重异常前置过滤",
      category: "listing",
      enabled: true,
      version: 1,
      conditions: { priceRatioBelow: DEFAULT_PRE_FILTER_CONFIGS.extremePriceRatio },
      scoreImpact: 0,
      explanation: "挂牌价显著低于市场参考价时，评分前直接拦截，不调用 JEV。",
      changeReason: "代码默认阈值；保存新版本后以数据库为准。",
      history: [],
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function describeRuleConditions(code: string, conditions: unknown, sellerOverrides?: SellerRuleThresholds): string {
  if (code === SELLER_NON_PERSONAL_FILTER_CODE) {
    const record = asRecord(conditions);
    const thresholds = sellerOverrides ?? {
      sameCategoryMinCount: typeof record.sameCategoryMinCount === "number" ? record.sameCategoryMinCount : DEFAULT_SELLER_RULE_THRESHOLDS.sameCategoryMinCount,
      onSaleMinCount: typeof record.onSaleMinCount === "number" ? record.onSaleMinCount : DEFAULT_SELLER_RULE_THRESHOLDS.onSaleMinCount,
      completedSaleMinCount: typeof record.completedSaleMinCount === "number" ? record.completedSaleMinCount : DEFAULT_SELLER_RULE_THRESHOLDS.completedSaleMinCount,
    };
    return `同品类已采集 ${thresholds.sameCategoryMinCount} 条、主页在售达到 ${thresholds.onSaleMinCount} 件或已核实售出超过 ${thresholds.completedSaleMinCount} 件，标记疑似非个人卖家。`;
  }
  const record = asRecord(conditions);
  if (code === COUNTERFEIT_TERMS_FILTER_CODE) {
    const terms = Array.isArray(record.terms) ? record.terms.filter((term): term is string => typeof term === "string") : [];
    return terms.length > 0 ? `命中词硬阻断：${terms.join("、")}。命中即在评分前拦截。` : "未配置词表，使用代码默认词表。";
  }
  if (code === EXTREME_PRICE_GAP_FILTER_CODE) {
    return typeof record.priceRatioBelow === "number"
      ? `挂牌价低于参考价 ${Math.round(record.priceRatioBelow * 100)}% 的线索在评分前拦截。`
      : "未配置阈值，使用代码默认阈值。";
  }
  return JSON.stringify(record);
}
