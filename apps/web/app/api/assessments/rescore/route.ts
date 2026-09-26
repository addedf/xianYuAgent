import { z } from "zod";
import { buildRuleFacts } from "@/src/domain/facts";
import { finalizeAssessment, filteredAssessment } from "@/src/domain/finalize";
import { runPreFilters } from "@/src/domain/pre-filters";
import { knowledgeHash, knowledgeUsed, selectKnowledge } from "@/src/domain/knowledge-context";
import { priceReferenceSnapshot } from "@/src/domain/price-reference";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { assessments, assessmentRuns } from "@/src/server/db/schema";
import { evaluateListing } from "@/src/server/evaluators/typesafe";
import { getServerEnv } from "@/src/server/env";
import { loadLatestAssessedListings } from "@/src/server/listings";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";
import { loadPreFilterSettings } from "@/src/server/pre-filter-settings";
import { loadActiveKnowledgeEntries } from "@/src/server/knowledge-injection";
import { filteredAssessmentFingerprint, scoredAssessmentFingerprint } from "@/src/server/sources/xianyu-spider-persistence";

const payloadSchema = z.object({ listingId: z.uuid() });

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  const payload = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return Response.json({ error: "商品编号格式不正确。" }, { status: 400 });

  try {
    const [item] = await loadLatestAssessedListings(1, payload.data.listingId, true);
    if (!item) return Response.json({ error: "没有找到这条入库商品。" }, { status: 404 });
    // 排除防复活：卖家已被排除的线索不重新评分、不重新激活（方案 6）。
    if (item.listing.sellerExcluded) {
      return Response.json({ error: "该线索的卖家已被排除，重新评分不会恢复展示；如需恢复请先在排除管理中撤销。" }, { status: 409 });
    }

    const sellerRuleSettings = await loadSellerRuleSettings();
    const preFilterSettings = await loadPreFilterSettings();
    const activePreFilterConfigs = { ...preFilterSettings.configs, sellerThresholds: sellerRuleSettings.enabled === false ? null : sellerRuleSettings.thresholds };
    const env = getServerEnv();
    const { db } = getDatabase();

    // 与导入管道同一套流程：前置过滤 → 事实构建 → JEV 评分 → 收敛落库。
    const filterHit = runPreFilters(item.listing, activePreFilterConfigs);
    if (filterHit) {
      const inputFingerprint = filteredAssessmentFingerprint(item.listing, filterHit, activePreFilterConfigs);
      const record = filteredAssessment(item.listing, filterHit);
      const values = {
        listingId: item.listing.id,
        inputFingerprint,
        rulesetVersion: record.rulesetVersion,
        modelVersion: null,
        modelConfidence: null,
        modelEvaluation: null,
        filterCode: record.filterCode ?? null,
        knowledgeUsed: [],
        priceReferenceUsed: priceReferenceSnapshot(item.listing),
        riskLevel: record.riskLevel,
        recommendedAction: record.recommendedAction,
        totalOpportunity: record.scores.totalOpportunity,
        scores: record.scores,
        evidence: record.evidence,
        missingInformation: record.missingInformation,
        summary: record.summary,
        evaluatedAt: new Date(record.evaluatedAt),
        updatedAt: new Date(),
      };
      await db.insert(assessments).values(values).onConflictDoUpdate({ target: [assessments.listingId, assessments.inputFingerprint], set: values });
      await db.insert(assessmentRuns).values({ listingId: item.listing.id, inputFingerprint, trigger: "manual", result: { filterCode: filterHit.code, knowledgeUsed: [], priceReferenceUsed: values.priceReferenceUsed } });
      return Response.json({ ok: true, jevEvaluated: false, filterCode: filterHit.code, totalOpportunity: 0 });
    }

    const facts = buildRuleFacts(item.listing, new Date());
    const selectedKnowledge = selectKnowledge(await loadActiveKnowledgeEntries(), item.listing);
    const evaluation = await evaluateListing(item.listing, facts, { mode: "manual", sellerRuleThresholds: activePreFilterConfigs.sellerThresholds, knowledge: selectedKnowledge });
    // JEV 不可用或失败时明确报错，不保存任何规则兜底结果；线索保持待评分状态。
    if (!evaluation) {
      return Response.json({ error: "JEV 不可用或评分失败，本次未保存评分；线索保持待评分状态。" }, { status: 503 });
    }

    const assessment = finalizeAssessment(item.listing, facts, evaluation, { confidenceThreshold: env.TYPESAFE_CONFIDENCE_THRESHOLD });
    assessment.knowledgeUsed = knowledgeUsed(selectedKnowledge);
    assessment.priceReferenceUsed = priceReferenceSnapshot(item.listing) ?? undefined;
    if (selectedKnowledge.length > 0) assessment.evidence.push({ code: "jev-knowledge-context", kind: "neutral", label: "已向 JEV 提供知识经验", detail: `本次注入 ${selectedKnowledge.length} 条已批准知识；这只表示进入评分输入，不代表模型逐条采纳。`, scoreImpact: 0, source: "knowledge" });
    const inputFingerprint = scoredAssessmentFingerprint(item.listing, activePreFilterConfigs.sellerThresholds, knowledgeHash(selectedKnowledge));
    const values = {
      listingId: item.listing.id,
      inputFingerprint,
      rulesetVersion: assessment.rulesetVersion,
      modelVersion: assessment.modelVersion ?? null,
      modelConfidence: assessment.modelConfidence ?? null,
      modelEvaluation: assessment.modelEvaluation ?? null,
      filterCode: null,
      knowledgeUsed: assessment.knowledgeUsed,
      priceReferenceUsed: assessment.priceReferenceUsed ?? null,
      riskLevel: assessment.riskLevel,
      recommendedAction: assessment.recommendedAction,
      totalOpportunity: assessment.scores.totalOpportunity,
      scores: assessment.scores,
      evidence: assessment.evidence,
      missingInformation: assessment.missingInformation,
      summary: assessment.summary,
      evaluatedAt: new Date(assessment.evaluatedAt),
      updatedAt: new Date(),
    };
    await db.insert(assessments).values(values).onConflictDoUpdate({
      target: [assessments.listingId, assessments.inputFingerprint],
      set: values,
    });
    await db.insert(assessmentRuns).values({ listingId: item.listing.id, inputFingerprint, trigger: "manual", result: {
      modelVersion: assessment.modelVersion, scores: assessment.scores, evidence: assessment.evidence,
      knowledgeUsed: assessment.knowledgeUsed, priceReferenceUsed: assessment.priceReferenceUsed ?? null,
      evaluatedAt: assessment.evaluatedAt,
    } });

    return Response.json({ ok: true, jevEvaluated: true, totalOpportunity: assessment.scores.totalOpportunity });
  } catch {
    return Response.json({ error: "重新评分失败，请检查数据库和 JEV 配置后重试。" }, { status: 503 });
  }
}
