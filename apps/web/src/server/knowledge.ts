import { and, desc, eq } from "drizzle-orm";
import type { Category, KnowledgeEntry } from "@/src/domain/listing";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "@/src/domain/seller-rules";
import { getDatabase } from "@/src/server/db/client";
import { feedbackEvents, knowledgeEntries, marketplaceListings, ruleDefinitions, ruleVersions } from "@/src/server/db/schema";
import { SELLER_RULE_CODE, SELLER_RULE_TITLE, parseSellerRuleThresholds } from "@/src/server/seller-rule-settings";

const entryTypes = new Set<KnowledgeEntry["entryType"]>(["identification", "seller-signal", "pricing", "question", "case"]);
const categories = new Set<Category>(["watch", "bag", "jewelry"]);
const confidenceLevels = new Set<KnowledgeEntry["confidence"]>(["draft", "reviewed", "verified"]);

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
}

export interface KnowledgeCandidateView {
  id: string;
  listingId: string;
  title: string;
  category: Category;
  label: string;
  text: string;
  createdAt: string;
}

export async function loadKnowledgeWorkbenchData() {
  const { db } = getDatabase();
  const entriesRows = await db.select().from(knowledgeEntries).orderBy(desc(knowledgeEntries.updatedAt));
  const definitions = await db.select().from(ruleDefinitions).orderBy(desc(ruleDefinitions.updatedAt));
  const rules: KnowledgeRuleView[] = [];
  for (const definition of definitions) {
    const [version] = await db.select().from(ruleVersions)
      .where(and(eq(ruleVersions.ruleId, definition.id), eq(ruleVersions.version, definition.currentVersion))).limit(1);
    rules.push({
      id: definition.id,
      code: definition.code,
      title: definition.title,
      category: definition.category,
      enabled: definition.enabled,
      version: definition.currentVersion,
      conditions: version?.conditions ?? {},
      scoreImpact: version?.scoreImpact ?? 0,
      explanation: version?.explanationTemplate ?? "",
      changeReason: version?.changeReason ?? "",
    });
  }
  if (!rules.some((rule) => rule.code === SELLER_RULE_CODE)) {
    rules.unshift({
      id: "seller-rule-default",
      code: SELLER_RULE_CODE,
      title: SELLER_RULE_TITLE,
      category: "seller",
      enabled: true,
      version: 1,
      conditions: DEFAULT_SELLER_RULE_THRESHOLDS,
      scoreImpact: -20,
      explanation: "达到任一阈值时标注疑似非个人卖家，并降低个人卖家概率。",
      changeReason: "系统默认阈值；保存后会记录为可追溯版本。",
    });
  }

  const candidateRows = await db.select({
    feedback: feedbackEvents,
    listingTitle: marketplaceListings.title,
    listingCategory: marketplaceListings.category,
  }).from(feedbackEvents)
    .innerJoin(marketplaceListings, eq(feedbackEvents.listingId, marketplaceListings.id))
    .where(and(eq(feedbackEvents.feedbackType, "rule-candidate"), eq(feedbackEvents.promotionStatus, "proposed")))
    .orderBy(desc(feedbackEvents.createdAt));
  const candidates: KnowledgeCandidateView[] = candidateRows.map(({ feedback, listingTitle, listingCategory }) => {
    const payload = feedback.knowledgeCandidate && typeof feedback.knowledgeCandidate === "object" && !Array.isArray(feedback.knowledgeCandidate)
      ? feedback.knowledgeCandidate as Record<string, unknown>
      : {};
    const category = categories.has(listingCategory as Category) ? listingCategory as Category : "watch";
    return {
      id: feedback.id,
      listingId: feedback.listingId,
      title: listingTitle,
      category,
      label: typeof payload.label === "string" && payload.label.trim() ? payload.label : feedback.finalLabel || "人工规则候选",
      text: typeof payload.text === "string" && payload.text.trim() ? payload.text : feedback.reason || "",
      createdAt: feedback.createdAt.toISOString(),
    };
  });

  const entries: KnowledgeEntry[] = entriesRows.flatMap((row) => {
    const entryType = entryTypes.has(row.entryType as KnowledgeEntry["entryType"]) ? row.entryType as KnowledgeEntry["entryType"] : null;
    const category = categories.has(row.category as Category) ? row.category as Category : null;
    const confidence = confidenceLevels.has(row.confidence as KnowledgeEntry["confidence"]) ? row.confidence as KnowledgeEntry["confidence"] : "draft";
    if (!entryType || !category) return [];
    return [{
      id: row.id,
      entryType,
      category,
      brand: row.brand || undefined,
      title: row.title,
      summary: row.currentSummary,
      confidence,
      version: row.currentVersion,
      sourceLabel: row.sourceLabel,
      updatedAt: row.updatedAt.toISOString(),
      usageCount: 0,
      active: row.active,
    }];
  });

  const sellerRule = rules.find((rule) => rule.code === SELLER_RULE_CODE);
  const thresholds: SellerRuleThresholds = parseSellerRuleThresholds(sellerRule?.conditions) ?? DEFAULT_SELLER_RULE_THRESHOLDS;
  return { entries, rules, candidates, thresholds };
}
