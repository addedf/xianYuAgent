import type { JevDimension, JevEvaluation } from "./jev";
import type { AssessmentEvidence, ListingAssessment, SellerProfile } from "./listing";
import { calculateTotalOpportunity, determineAction, determineRiskLevel, summarizeAction } from "./scoring";
import { nonPersonalSellerReason, sameCategoryListingCount } from "./seller";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "./seller-rules";

const labels: Record<JevDimension, string> = {
  personalSeller: "个人卖家概率", authenticityRisk: "疑假风险", informationCompleteness: "信息充分度",
};

export function fuseAssessment(rule: ListingAssessment, jev: JevEvaluation | null, confidenceThreshold = 55, seller?: Pick<SellerProfile, "activeListingCount" | "sameCategoryRatio" | "sameCategoryCount" | "completedSaleCount" | "completedSaleCountVerified" | "identityScope" | "signalScope">, sellerRuleThresholds: SellerRuleThresholds = DEFAULT_SELLER_RULE_THRESHOLDS): ListingAssessment {
  if (!jev) return rule;
  const scores = { ...rule.scores };
  const evidence = [...rule.evidence];
  const modelConfidence = Math.round(100 * (jev.scores.authenticityRisk.confidence * 0.4 + jev.scores.personalSeller.confidence * 0.4 + jev.scores.informationCompleteness.confidence * 0.2));
  for (const dimension of Object.keys(labels) as JevDimension[]) {
    const model = jev.scores[dimension];
    // JEV owns the judgment for rubric-scored dimensions. Rule scores provide
    // structured evidence and a light prior, rather than limiting the model.
    const weight = 0.65 + 0.3 * model.confidence;
    const blended = Math.round(rule.scores[dimension] * (1 - weight) + model.score * weight);
    scores[dimension] = Math.max(0, Math.min(100, blended));
    const impact = scores[dimension] - rule.scores[dimension];
    if (impact !== 0) evidence.push({
      code: `jev-${dimension}`, kind: "neutral", label: `JEV 主评分：${labels[dimension]}`,
      detail: `JEV 分 ${model.score}，置信度 ${Math.round(model.confidence * 100)}%；规则参考分 ${rule.scores[dimension]}，最终分 ${scores[dimension]}。主要 rubric 信号：${model.signal}。`,
      scoreImpact: impact, source: "model", probabilities: model.probabilities,
    });
  }
  const sellerSignalObserved = seller?.signalScope === "observed-listings"
    || seller?.signalScope === "complete-profile"
    || seller?.completedSaleCountVerified === true
    || (seller?.activeListingCount ?? 0) > 0;
  const nonPersonalReason = seller ? nonPersonalSellerReason(seller, sellerRuleThresholds) : null;
  if (seller && sellerSignalObserved && nonPersonalReason) {
    const sameCategoryCount = sameCategoryListingCount(seller);
    const cap = seller.completedSaleCountVerified && (seller.completedSaleCount ?? 0) > sellerRuleThresholds.completedSaleMinCount
      ? 24
      : sameCategoryCount >= 20
        ? 18
        : sameCategoryCount >= 10
          ? 24
          : 32;
    const beforeGuard = scores.personalSeller;
    scores.personalSeller = Math.min(scores.personalSeller, cap);
    if (beforeGuard > cap) {
      evidence.push({
        code: "seller-observed-volume-jev-cap",
        kind: "risk",
        label: "非个人卖家规则限制 JEV 评分",
        detail: `${nonPersonalReason}；融合后个人卖家分限制为 ${cap}。`,
        scoreImpact: cap - beforeGuard,
        source: "seller",
      });
    } else if (!evidence.some((item) => item.code === "seller-observed-volume-guard")) {
      const impact = 0;
      evidence.push({
        code: "seller-observed-volume-guard",
        kind: "risk",
        label: "非个人卖家规则限分",
        detail: `${nonPersonalReason}；将个人卖家分限制为 ${cap}。观察范围受采集关键词和时间影响，不等同于完整主页。`,
        scoreImpact: impact,
        source: "seller",
      });
    }
  }
  evidence.push({
    code: "jev-seller-type", kind: "neutral", label: "JEV 卖家类型判断",
    detail: `倾向 ${jev.sellerType.choice}，置信度 ${Math.round(jev.sellerType.confidence * 100)}%。`,
    scoreImpact: 0, source: "model", probabilities: jev.sellerType.probabilities,
  }, {
    code: "jev-text-signals", kind: "neutral", label: "模型文案信号",
    detail: "JEV 文案信号作为评分证据，不是实物鉴定结论。",
    scoreImpact: 0, source: "model", probabilities: { "疑假暗示": jev.counterfeitClaim, "个人使用故事": jev.personalStory },
  });
  scores.totalOpportunity = calculateTotalOpportunity(scores);
  const hardBlocked = rule.evidence.some((item) => item.code === "listing-suspicious-terms");
  let recommendedAction = determineAction(scores.totalOpportunity, scores.authenticityRisk, scores.informationCompleteness, scores.personalSeller);
  if (hardBlocked) recommendedAction = "skip";
  else if (modelConfidence < confidenceThreshold) {
    // Preserve a rule-based block, but never let an uncertain model introduce notify/skip.
    if (rule.recommendedAction === "skip") recommendedAction = "skip";
    else if (recommendedAction === "notify" || recommendedAction === "skip") recommendedAction = "review";
  }
  return {
    ...rule, scores, recommendedAction,
    riskLevel: hardBlocked ? "high" : determineRiskLevel(scores.authenticityRisk, scores.informationCompleteness),
    summary: summarizeAction(recommendedAction),
    evidence: evidence.sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact)),
    modelConfidence, modelVersion: jev.modelVersion,
    modelEvaluation: jev.raw,
    modelReviewRequired: modelConfidence < confidenceThreshold,
  };
}

export function withModelUnavailable(rule: ListingAssessment): ListingAssessment {
  const evidence: AssessmentEvidence = { code: "jev-unavailable", kind: "neutral", label: "JEV 未返回结果", detail: "本次保存规则回退分；JEV 未成功评分的内容版本可在后续扫描重试，JEV 成功后则直接读取已保存评分。", scoreImpact: 0, source: "model" };
  return { ...rule, evidence: [...rule.evidence, evidence] };
}
