import { ACCESSORY_TERMS, FACT_SCORE_PARAMETERS, FACT_THRESHOLDS, PERSONAL_TERMS, PURCHASE_PROOF_TERMS, SERIAL_TERMS } from "./facts";
import { ACTION_THRESHOLDS, OPPORTUNITY_WEIGHTS, RULESET_VERSION } from "./finalize";
import { COUNTERFEIT_TERMS_FILTER_CODE, EXTREME_PRICE_GAP_FILTER_CODE, SELLER_NON_PERSONAL_FILTER_CODE } from "./pre-filters";
import { describeRuleConditions, type KnowledgeRuleView } from "./rule-views";

export type RulePhase = "前置过滤" | "事实提取" | "JEV 上下文" | "收敛与动作";
export const RULE_PHASES: RulePhase[] = ["前置过滤", "事实提取", "JEV 上下文", "收敛与动作"];

export interface RuleRegistryItem {
  code: string;
  title: string;
  phase: RulePhase;
  // 人话化的一行取值，总账页直接展示。
  currentValue: string;
  // 原始 JSON 配置，总账页折叠展示，保证可核对又不占版面。
  rawValue?: string;
  // 长说明（例如 JEV 指令与 rubric 全文），总账页折叠展示。
  detail?: string;
  source: string;
  effect: string;
  editable: boolean;
  enabled: boolean;
}

export interface JevPromptFacts {
  instruction: string;
  rubrics: Record<string, readonly string[]>;
}

function formatFactThresholds(): string {
  return `价格差参考 ${Math.round(FACT_THRESHOLDS.priceGapRatio * 100)}% · 模板相似度 ${Math.round(FACT_THRESHOLDS.templateSimilarity * 100)}% · 品类集中 ${FACT_THRESHOLDS.concentrationCount} 条且占比 ${Math.round(FACT_THRESHOLDS.concentrationRatio * 100)}% · 描述不足 ${FACT_THRESHOLDS.minimumDescriptionLength} 字 · 图片少于 ${FACT_THRESHOLDS.minimumImageCount} 张`;
}

function formatFactScoreParameters(): string {
  return `品类匹配 ${FACT_SCORE_PARAMETERS.categoryMatched}/${FACT_SCORE_PARAMETERS.categoryUnmatched} 分 · 利润空间 ${FACT_SCORE_PARAMETERS.profitBase} 分 + 价差率 ×${FACT_SCORE_PARAMETERS.profitMarginMultiplier}（无参考价 ${FACT_SCORE_PARAMETERS.profitWithoutReference} 分） · 时效 ${FACT_SCORE_PARAMETERS.recencyBands.length} 档衰减、兜底 ${FACT_SCORE_PARAMETERS.recencyAfterBands} 分`;
}

function formatOpportunityWeights(): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return `个人卖家 ${percent(OPPORTUNITY_WEIGHTS.personalSeller)} · 疑假安全 ${percent(OPPORTUNITY_WEIGHTS.authenticitySafety)} · 信息充分 ${percent(OPPORTUNITY_WEIGHTS.informationCompleteness)} · 利润空间 ${percent(OPPORTUNITY_WEIGHTS.profitOpportunity)} · 品类匹配 ${percent(OPPORTUNITY_WEIGHTS.categoryMatch)} · 时效 ${percent(OPPORTUNITY_WEIGHTS.recency)}`;
}

function formatActionThresholds(): string {
  return `高风险 ≥${ACTION_THRESHOLDS.highRisk} · 中风险 ≥${ACTION_THRESHOLDS.mediumRisk} · 信息不足 <${ACTION_THRESHOLDS.incompleteBelow} · 个人卖家 <${ACTION_THRESHOLDS.personalSellerSkipBelow} 直接跳过 · 提醒需总分 ≥${ACTION_THRESHOLDS.notifyTotalAtLeast}`;
}

function formatJevDetail(jev: JevPromptFacts): string {
  const rubricSections = Object.entries(jev.rubrics)
    .map(([name, levels]) => `【${name}】\n${levels.map((level, index) => `${index + 1}. ${level}`).join("\n")}`)
    .join("\n\n");
  return `${jev.instruction}\n\n评分 rubric：\n${rubricSections}`;
}

export function buildRuleRegistry(rules: KnowledgeRuleView[], confidenceThreshold: number, rateLimit: number, questionsVersion: string, jev: JevPromptFacts): RuleRegistryItem[] {
  const byCode = new Map(rules.map((rule) => [rule.code, rule]));
  const dbRule = (code: string, title: string, effect: string): RuleRegistryItem => {
    const rule = byCode.get(code);
    const enabled = rule?.enabled !== false;
    return {
      code,
      title,
      phase: "前置过滤",
      currentValue: !enabled ? "已停用" : rule ? describeRuleConditions(code, rule.conditions) : "未配置，使用代码默认值",
      rawValue: rule ? JSON.stringify(rule.conditions) : undefined,
      source: rule?.id.startsWith("default-") ? "代码默认" : `数据库 v${rule?.version ?? 1}`,
      effect,
      editable: true,
      enabled,
    };
  };
  const fixed = (code: string, title: string, phase: RulePhase, currentValue: string, effect: string, rawValue?: string, detail?: string): RuleRegistryItem =>
    ({ code, title, phase, currentValue, rawValue, detail, source: `代码 · ${RULESET_VERSION}`, effect, editable: false, enabled: true });
  const rubricSummary = Object.entries(jev.rubrics).map(([name, levels]) => `${name} ${levels.length} 档`).join(" · ");
  return [
    dbRule(COUNTERFEIT_TERMS_FILTER_CODE, "高仿词硬阻断", "命中时不调用 JEV，线索进入已过滤。"),
    dbRule(EXTREME_PRICE_GAP_FILTER_CODE, "价格比例过滤", "仅有经复核市场参考价时才可能命中。"),
    dbRule(SELLER_NON_PERSONAL_FILTER_CODE, "非个人卖家阈值", "观察信号达到阈值时跳过 JEV。"),
    fixed("facts-personal-terms", "个人叙事词", "事实提取", PERSONAL_TERMS.join("、"), "形成参考信号，不直接加分。"),
    fixed("facts-serial-terms", "编号词", "事实提取", SERIAL_TERMS.join("、"), "用于信息缺失判断。"),
    fixed("facts-proof-terms", "凭证词", "事实提取", PURCHASE_PROOF_TERMS.join("、"), "用于信息缺失判断。"),
    fixed("facts-accessory-terms", "附件词", "事实提取", ACCESSORY_TERMS.join("、"), "用于信息缺失判断。"),
    fixed("facts-signal-thresholds", "事实信号阈值", "事实提取", formatFactThresholds(), "模板相似度、品类集中度、描述长度、图片数量及价格差参考信号。", JSON.stringify(FACT_THRESHOLDS)),
    fixed("facts-hard-values", "客观事实计算", "事实提取", formatFactScoreParameters(), "品类匹配、利润空间和时效形成总分中占 30% 的客观分。", JSON.stringify(FACT_SCORE_PARAMETERS)),
    fixed("jev-instruction", "JEV 问题与评分指令", "JEV 上下文", `${questionsVersion} · ${Object.keys(jev.rubrics).length} 项评分 rubric（${rubricSummary}）`, "只用已批准知识作为参考上下文；JEV 是主评分来源。", undefined, formatJevDetail(jev)),
    fixed("jev-control", "JEV 置信度与限频", "JEV 上下文", `置信度阈值 ${confidenceThreshold} · 限频 ${rateLimit} 次/分钟`, "低置信度封顶人工复核；限频控制调用。"),
    fixed("finalize-weights", "机会分权重", "收敛与动作", formatOpportunityWeights(), "JEV 三维占 70%，客观事实占 30%。", JSON.stringify(OPPORTUNITY_WEIGHTS)),
    fixed("finalize-actions", "风险与动作阈值", "收敛与动作", formatActionThresholds(), "决定风险等级、提醒、复核或跳过。", JSON.stringify(ACTION_THRESHOLDS)),
  ];
}
