import type { JevDimension, JevEvaluation } from "./jev";
import type { AssessmentEvidence, AssessmentScores, ListingAssessment, MarketplaceListing, RecommendedAction, RiskLevel } from "./listing";
import type { FactSignal, RuleFacts } from "./facts";
import type { PreFilterHit } from "./pre-filters";

// 收敛层是全链路唯一的守护栏：JEV 三维分数直接采用，不再与规则分混合；
// 客观硬事实（品类匹配/利润空间/时效）按固定权重进入总分；
// 置信度不足时只允许把动作封顶为人工复核，不允许模型直接产生跳过或提醒。

export const RULESET_VERSION = "2026.09.24-v5";
export const DEFAULT_CONFIDENCE_THRESHOLD = 55;
export const OPPORTUNITY_WEIGHTS = { categoryMatch: 0.1, personalSeller: 0.3, authenticitySafety: 0.3, informationCompleteness: 0.1, profitOpportunity: 0.15, recency: 0.05 } as const;
export const ACTION_THRESHOLDS = { highRisk: 70, personalSellerSkipBelow: 20, mediumRisk: 36, incompleteBelow: 58, notifyTotalAtLeast: 65 } as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateTotalOpportunity(scores: Pick<AssessmentScores, "categoryMatch" | "personalSeller" | "authenticityRisk" | "informationCompleteness" | "profitOpportunity" | "recency">): number {
  // JEV 的三项 rubric 判断占总机会分 70%；规则只贡献硬事实（品类匹配、价差空间、时效）。
  return clamp(scores.categoryMatch * OPPORTUNITY_WEIGHTS.categoryMatch + scores.personalSeller * OPPORTUNITY_WEIGHTS.personalSeller + (100 - scores.authenticityRisk) * OPPORTUNITY_WEIGHTS.authenticitySafety + scores.informationCompleteness * OPPORTUNITY_WEIGHTS.informationCompleteness + scores.profitOpportunity * OPPORTUNITY_WEIGHTS.profitOpportunity + scores.recency * OPPORTUNITY_WEIGHTS.recency);
}

export function determineRiskLevel(risk: number, completeness: number): RiskLevel {
  if (risk >= ACTION_THRESHOLDS.highRisk) return "high";
  if (completeness < ACTION_THRESHOLDS.incompleteBelow) return "insufficient";
  if (risk >= ACTION_THRESHOLDS.mediumRisk) return "medium";
  return "low";
}

export function determineAction(total: number, risk: number, completeness: number, personalSeller: number): RecommendedAction {
  if (risk >= ACTION_THRESHOLDS.highRisk || personalSeller < ACTION_THRESHOLDS.personalSellerSkipBelow) return "skip";
  if (risk >= ACTION_THRESHOLDS.mediumRisk || completeness < ACTION_THRESHOLDS.incompleteBelow) return "review";
  if (total >= ACTION_THRESHOLDS.notifyTotalAtLeast) return "notify";
  return "archive";
}

export function summarizeAction(recommendedAction: RecommendedAction): string {
  return (
    recommendedAction === "notify"
      ? "个人卖家信号与价格空间较好，建议尽快人工查看并决定是否询价。"
      : recommendedAction === "review"
        ? "存在信息缺口或中等风险，建议先补图和核对来源。"
        : recommendedAction === "skip"
          ? "命中高风险或职业卖家信号，默认不主动联系。"
          : "机会分暂未达到提醒阈值，保留记录用于后续校准。"
  );
}

const dimensionLabels: Record<JevDimension, string> = {
  personalSeller: "个人卖家概率",
  authenticityRisk: "疑假风险",
  informationCompleteness: "信息充分度",
};

function factEvidenceRows(facts: RuleFacts): AssessmentEvidence[] {
  const missingRow: FactSignal[] = facts.missing.length > 0
    ? [{ code: "listing-missing-information", kind: "missing", label: "关键信息仍不完整", detail: `建议补充：${facts.missing.join("、")}。`, source: "knowledge" }]
    : [];
  return [...facts.issues, ...facts.positives, ...missingRow].map((signal) => ({
    code: signal.code,
    kind: signal.kind,
    label: signal.label,
    detail: signal.detail,
    scoreImpact: 0,
    source: signal.source,
  }));
}

function modelEvidenceRows(jev: JevEvaluation): AssessmentEvidence[] {
  const dimensionRows = (Object.keys(dimensionLabels) as JevDimension[]).map((dimension) => {
    const model = jev.scores[dimension];
    return {
      code: `jev-${dimension}`,
      kind: "neutral" as const,
      label: `JEV 主评分：${dimensionLabels[dimension]}`,
      detail: `JEV 分 ${model.score}，置信度 ${Math.round(model.confidence * 100)}%；主要 rubric 信号：${model.signal}。`,
      scoreImpact: 0,
      source: "model" as const,
      probabilities: model.probabilities,
    };
  });
  return [
    ...dimensionRows,
    {
      code: "jev-seller-type",
      kind: "neutral",
      label: "JEV 卖家类型判断",
      detail: `倾向 ${jev.sellerType.choice}，置信度 ${Math.round(jev.sellerType.confidence * 100)}%。`,
      scoreImpact: 0,
      source: "model",
      probabilities: jev.sellerType.probabilities,
    },
    {
      code: "jev-text-signals",
      kind: "neutral",
      label: "模型文案信号",
      detail: "JEV 文案信号作为评分证据，不是实物鉴定结论。",
      scoreImpact: 0,
      source: "model",
      probabilities: { 疑假暗示: jev.counterfeitClaim, 个人使用故事: jev.personalStory },
    },
  ];
}

export function finalizeAssessment(listing: MarketplaceListing, facts: RuleFacts, jev: JevEvaluation, options: { confidenceThreshold?: number; now?: Date } = {}): ListingAssessment {
  const confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const now = options.now ?? new Date();
  const scores: AssessmentScores = {
    categoryMatch: facts.hardFacts.categoryMatch,
    profitOpportunity: facts.hardFacts.profitOpportunity,
    recency: facts.hardFacts.recency,
    personalSeller: jev.scores.personalSeller.score,
    authenticityRisk: jev.scores.authenticityRisk.score,
    informationCompleteness: jev.scores.informationCompleteness.score,
    totalOpportunity: 0,
  };
  scores.totalOpportunity = calculateTotalOpportunity(scores);

  const modelConfidence = Math.round(100 * (jev.scores.authenticityRisk.confidence * 0.4 + jev.scores.personalSeller.confidence * 0.4 + jev.scores.informationCompleteness.confidence * 0.2));
  let recommendedAction = determineAction(scores.totalOpportunity, scores.authenticityRisk, scores.informationCompleteness, scores.personalSeller);
  const modelReviewRequired = modelConfidence < confidenceThreshold;
  // 不确定的模型不允许直接产生 notify/skip：封顶为人工复核，偏保守。
  if (modelReviewRequired && (recommendedAction === "notify" || recommendedAction === "skip")) recommendedAction = "review";

  const evidence = [...factEvidenceRows(facts), ...modelEvidenceRows(jev)].sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact));

  return {
    listingId: listing.id,
    riskLevel: determineRiskLevel(scores.authenticityRisk, scores.informationCompleteness),
    recommendedAction,
    scores,
    evidence,
    missingInformation: facts.missing,
    suggestedQuestions: facts.suggestedQuestions,
    summary: summarizeAction(recommendedAction),
    evaluatedAt: now.toISOString(),
    rulesetVersion: RULESET_VERSION,
    modelConfidence,
    modelVersion: jev.modelVersion,
    modelEvaluation: jev.raw,
    modelReviewRequired,
  };
}

const ZERO_SCORES: AssessmentScores = {
  categoryMatch: 0, personalSeller: 0, authenticityRisk: 0, informationCompleteness: 0, profitOpportunity: 0, recency: 0, totalOpportunity: 0,
};

export function pendingAssessment(listing: MarketplaceListing, now = new Date()): ListingAssessment {
  return {
    listingId: listing.id,
    riskLevel: "insufficient",
    recommendedAction: "review",
    scores: { ...ZERO_SCORES },
    evidence: [{
      code: "jev-pending",
      kind: "missing",
      label: "待模型评分",
      detail: "线索已入库；JEV 评分暂不可用（未配置、总开关关闭或评分失败），恢复后的下一次扫描会自动补评。",
      scoreImpact: 0,
      source: "model",
    }],
    missingInformation: [],
    suggestedQuestions: [],
    summary: "等待 JEV 评分：线索已入库并保留完整原始证据，评分恢复后自动补评。",
    evaluatedAt: now.toISOString(),
    rulesetVersion: RULESET_VERSION,
    pending: true,
  };
}

export function filteredAssessment(listing: MarketplaceListing, hit: PreFilterHit, now = new Date()): ListingAssessment {
  return {
    listingId: listing.id,
    riskLevel: hit.riskLevel,
    recommendedAction: "skip",
    scores: { ...ZERO_SCORES },
    evidence: [{
      code: hit.code,
      kind: "risk",
      label: `前置过滤：${hit.label}`,
      detail: hit.detail,
      scoreImpact: 0,
      source: hit.source,
    }],
    missingInformation: [],
    suggestedQuestions: [],
    summary: `已由前置过滤器拦截（${hit.label}），默认不在线索列表展示；如属误杀请在「已过滤」视图中人工纠正。`,
    evaluatedAt: now.toISOString(),
    rulesetVersion: RULESET_VERSION,
    filterCode: hit.code,
  };
}
