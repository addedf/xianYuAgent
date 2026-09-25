import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Category, KnowledgeEntry } from "@/src/domain/listing";
import { PIPELINE_RULE_CODES, defaultRuleViews, type KnowledgeRuleView, type RuleVersionView } from "@/src/domain/rule-views";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "@/src/domain/seller-rules";
import { buildRuleRegistry, type RuleRegistryItem } from "@/src/domain/rule-registry";
import { JEV_INSTRUCTION, QUESTIONS_VERSION, scoreRubrics } from "@/src/server/evaluators/typesafe/questions";
import { getServerEnv } from "@/src/server/env";
import { getDatabase } from "@/src/server/db/client";
import { feedbackEvents, knowledgeEntries, knowledgeVersions, marketPriceReferences, marketplaceListings, ruleDefinitions, ruleVersions } from "@/src/server/db/schema";
import { SELLER_RULE_CODE, parseSellerRuleThresholds } from "@/src/server/seller-rule-settings";

export type { KnowledgeRuleView } from "@/src/domain/rule-views";

const entryTypes = new Set<KnowledgeEntry["entryType"]>(["identification", "seller-signal", "pricing", "question", "case"]);
const categories = new Set<Category>(["watch", "bag", "jewelry", "other"]);
const confidenceLevels = new Set<KnowledgeEntry["confidence"]>(["draft", "reviewed", "verified"]);

export interface KnowledgeCandidateView {
  id: string;
  listingId: string;
  title: string;
  category: Category;
  label: string;
  text: string;
  createdAt: string;
}

export interface KnowledgeVersionView {
  version: number;
  content: Record<string, unknown>;
  changeReason: string;
  sourceType: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface PriceReferenceListingView { id: string; title: string; category: string; brand: string; model?: string; price: number }
export interface PriceReferenceView {
  id: string; listingId?: string; version: number; category: string; brand: string; model: string;
  amount: number; currency: string; priceType: string; conditionGrade: string; productionYear?: number;
  accessories: string[]; market: string; marketRegion?: string; conditionNote: string; sourceLabel: string;
  sourceUrl?: string; sampleCount: number; sampleEvidence: Array<{ sourceLabel: string; amount: number; observedAt: string }>; observedAt: string; status: string; origin: string;
  changeReason: string; applied: boolean;
  superseded: boolean;
}

export interface RuleLedgerData {
  rules: KnowledgeRuleView[];
  thresholds: SellerRuleThresholds;
  registry: RuleRegistryItem[];
}

async function loadRuleViewsFromDb(): Promise<{ rules: KnowledgeRuleView[]; thresholds: SellerRuleThresholds }> {
  const { db } = getDatabase();
  const definitions = await db.select().from(ruleDefinitions).orderBy(desc(ruleDefinitions.updatedAt));
  const byCode = new Map<string, KnowledgeRuleView>();
  for (const definition of definitions) {
    const versionRows = await db.select({
      version: ruleVersions.version,
      conditions: ruleVersions.conditions,
      scoreImpact: ruleVersions.scoreImpact,
      explanationTemplate: ruleVersions.explanationTemplate,
      changeReason: ruleVersions.changeReason,
      sourceType: ruleVersions.sourceType,
      approvedBy: ruleVersions.approvedBy,
      createdAt: ruleVersions.createdAt,
    }).from(ruleVersions).where(eq(ruleVersions.ruleId, definition.id)).orderBy(desc(ruleVersions.version));
    const current = versionRows.find((row) => row.version === definition.currentVersion);
    const history: RuleVersionView[] = versionRows.map((row) => ({
      version: row.version,
      conditions: row.conditions,
      changeReason: row.changeReason ?? "",
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
      approvedBy: row.approvedBy ?? "",
    }));
    byCode.set(definition.code, {
      id: definition.id,
      code: definition.code,
      title: definition.title,
      category: definition.category,
      enabled: definition.enabled,
      version: definition.currentVersion,
      conditions: current?.conditions ?? {},
      scoreImpact: current?.scoreImpact ?? 0,
      explanation: current?.explanationTemplate ?? "",
      changeReason: current?.changeReason ?? "",
      history,
    });
  }
  // 三个评分链路规则即使尚未入库也以代码默认值展示，保证全部生效规则可见。
  const rules: KnowledgeRuleView[] = defaultRuleViews().map((fallback) => byCode.get(fallback.code) ?? fallback);
  for (const [code, view] of byCode) if (!PIPELINE_RULE_CODES.includes(code)) rules.push(view);
  const sellerRule = rules.find((rule) => rule.code === SELLER_RULE_CODE);
  const thresholds: SellerRuleThresholds = parseSellerRuleThresholds(sellerRule?.conditions) ?? DEFAULT_SELLER_RULE_THRESHOLDS;
  return { rules, thresholds };
}

async function appendPriceReferenceEffect(registry: RuleRegistryItem[]): Promise<void> {
  const { client } = getDatabase();
  const [row] = await client<{ count: number }[]>`
    select count(*)::int as count from marketplace_listings
    where market_reference_id is not null and market_reference_expires_at > now()`;
  const item = registry.find((entry) => entry.code === "listing-extreme-price-gap");
  if (item) item.effect += row && row.count > 0
    ? ` 当前 ${row.count} 条商品有关联且未过期的参考价。`
    : " 当前 0 条商品有关联且未过期的参考价：规则已配置，暂无可执行数据。";
}

// 总账页专用轻量加载：只取规则视图与注册表，不查知识条目与参考价列表。
export async function loadRuleLedgerData(): Promise<RuleLedgerData> {
  const { rules, thresholds } = await loadRuleViewsFromDb();
  const env = getServerEnv();
  const registry = buildRuleRegistry(rules, env.TYPESAFE_CONFIDENCE_THRESHOLD, env.TYPESAFE_RATE_LIMIT_PER_MIN ?? 30, QUESTIONS_VERSION, { instruction: JEV_INSTRUCTION, rubrics: scoreRubrics });
  await appendPriceReferenceEffect(registry);
  return { rules, thresholds, registry };
}

export async function loadKnowledgeWorkbenchData() {
  const { db, client } = getDatabase();
  const { rules, thresholds, registry } = await loadRuleLedgerData();
  const entriesRows = await db.select().from(knowledgeEntries).orderBy(desc(knowledgeEntries.updatedAt));
  const versionRows = await db.select().from(knowledgeVersions).orderBy(desc(knowledgeVersions.version));
  const originById = new Map(versionRows.filter((row) => row.version === 1).map((row) => [row.knowledgeEntryId, row.sourceType]));
  const history: Record<string, KnowledgeVersionView[]> = {};
  for (const row of versionRows) (history[row.knowledgeEntryId] ??= []).push({
    version: row.version,
    content: row.content && typeof row.content === "object" && !Array.isArray(row.content) ? row.content as Record<string, unknown> : {},
    changeReason: row.changeReason,
    sourceType: row.sourceType,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
  const usageRows = await client<{ id: string; usage_count: number }[]>`
    select split_part(used.value, ':', 1) as id, count(*)::int as usage_count
    from assessments a cross join lateral jsonb_array_elements_text(a.knowledge_used) as used(value)
    where a.model_version is not null
    group by 1`;
  const usageById = new Map(usageRows.map((row) => [row.id, row.usage_count]));

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
    const category = categories.has(listingCategory as Category) ? listingCategory as Category : "other";
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
      model: row.model || undefined,
      title: row.title,
      summary: row.currentSummary,
      confidence,
      version: row.currentVersion,
      sourceLabel: row.sourceLabel,
      updatedAt: row.updatedAt.toISOString(),
      usageCount: usageById.get(row.id) ?? 0,
      active: row.active,
      effectChannel: row.effectChannel as KnowledgeEntry["effectChannel"],
      reviewStatus: row.reviewStatus as KnowledgeEntry["reviewStatus"],
      sourceType: originById.get(row.id) as KnowledgeEntry["sourceType"] | undefined,
    }];
  });

  const priceListingRows = await db.select({ id: marketplaceListings.id, title: marketplaceListings.title, category: marketplaceListings.category, brand: marketplaceListings.brand, model: marketplaceListings.model, price: marketplaceListings.price, referenceId: marketplaceListings.marketReferenceId })
    .from(marketplaceListings).orderBy(desc(marketplaceListings.firstSeenAt)).limit(100);
  const priceListings: PriceReferenceListingView[] = priceListingRows.map((row) => ({ id: row.id, title: row.title, category: row.category, brand: row.brand ?? "待识别品牌", model: row.model ?? undefined, price: Number(row.price) }));
  const activeReferenceRows = await db.select({ id: marketplaceListings.id, referenceId: marketplaceListings.marketReferenceId })
    .from(marketplaceListings).where(isNotNull(marketplaceListings.marketReferenceId));
  const appliedReferences = new Map(activeReferenceRows.map((row) => [row.id, row.referenceId]));
  const priceRows = await db.select().from(marketPriceReferences).orderBy(desc(marketPriceReferences.createdAt)).limit(200);
  const latestPriceVersionByScope = new Map<string, number>();
  for (const row of priceRows) latestPriceVersionByScope.set(row.scopeKey, Math.max(latestPriceVersionByScope.get(row.scopeKey) ?? 0, row.version));
  const priceReferences: PriceReferenceView[] = priceRows.map((row) => ({
    id: row.id, listingId: row.listingId ?? undefined, version: row.version, category: row.category, brand: row.brand, model: row.model,
    amount: Number(row.amount), currency: row.currency, priceType: row.priceType,
    conditionGrade: row.conditionGrade, productionYear: row.productionYear ?? undefined,
    accessories: Array.isArray(row.accessories) ? row.accessories.filter((item): item is string => typeof item === "string") : [],
    market: row.market, marketRegion: row.marketRegion ?? undefined, conditionNote: row.conditionNote,
    sourceLabel: row.sourceLabel, sourceUrl: row.sourceUrl ?? undefined, sampleCount: row.sampleCount,
    sampleEvidence: Array.isArray(row.sampleEvidence) ? row.sampleEvidence.filter((item): item is { sourceLabel: string; amount: number; observedAt: string } => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return typeof value.sourceLabel === "string" && typeof value.amount === "number" && typeof value.observedAt === "string";
    }) : [],
    observedAt: row.observedAt.toISOString(), status: row.status, origin: row.origin, changeReason: row.changeReason,
    applied: row.listingId !== null && row.status === "approved" && appliedReferences.get(row.listingId) === row.id,
    superseded: row.version < (latestPriceVersionByScope.get(row.scopeKey) ?? row.version),
  }));
  return { entries, history, rules, candidates, thresholds, registry, priceListings, priceReferences };
}
