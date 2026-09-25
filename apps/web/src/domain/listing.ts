export const CATEGORY_VALUES = ["watch", "bag", "jewelry", "other"] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

export type EvidenceKind = "positive" | "risk" | "missing" | "neutral";
export type RiskLevel = "low" | "insufficient" | "medium" | "high";
export type RecommendedAction = "notify" | "review" | "archive" | "skip";
export type ListingStatus = "active" | "possibly_sold";

export interface SellerProfile {
  externalId: string;
  displayName: string;
  region: string;
  activeListingCount: number;
  sameCategoryRatio: number;
  sameCategoryCount?: number;
  completedSaleCount?: number;
  completedSaleCountVerified?: boolean;
  onSaleCount?: number;
  creditLevel?: string;
  observedCategoryCounts?: Partial<Record<Category, number>>;
  /** 主页在售列表的原始分类分布（平台分类名 → 数量），仅 complete-profile 时有值。 */
  profileCategoryMix?: Record<string, number>;
  identityScope?: "stable-platform-id" | "nickname-region" | "unknown";
  signalScope?: "observed-listings" | "complete-profile" | "nickname-only";
  templateSimilarity: number;
  hasPersonalStorySignals: boolean;
  hasNaturalSceneSignals: boolean;
  accountAgeDays?: number;
}

export interface MarketplaceListing {
  id: string;
  externalId: string;
  platform: "xianyu" | "demo";
  category: Category;
  brand: string;
  model?: string;
  title: string;
  description: string;
  price: number;
  marketReferencePrice?: number;
  marketReferenceId?: string;
  marketReferenceVersion?: number;
  region: string;
  distanceKm?: number;
  publishedAt: string;
  firstSeenAt: string;
  imageUrls: string[];
  duplicateImageCount: number;
  hasSerialDetail: boolean;
  hasPurchaseProof: boolean;
  hasAccessoryDescription: boolean;
  monitorKeywords: string[];
  sourceUrl?: string;
  seller: SellerProfile;
  status?: ListingStatus;
  lastSeenAt?: string;
  absentScanCount?: number;
}

export interface AssessmentEvidence {
  code: string;
  kind: EvidenceKind;
  label: string;
  detail: string;
  scoreImpact: number;
  source: "rule" | "knowledge" | "market" | "seller" | "model";
  probabilities?: Record<string, number>;
}

export interface AssessmentScores {
  categoryMatch: number;
  personalSeller: number;
  authenticityRisk: number;
  informationCompleteness: number;
  profitOpportunity: number;
  recency: number;
  totalOpportunity: number;
}

export interface ListingAssessment {
  assessmentId?: string;
  listingId: string;
  riskLevel: RiskLevel;
  recommendedAction: RecommendedAction;
  scores: AssessmentScores;
  evidence: AssessmentEvidence[];
  missingInformation: string[];
  suggestedQuestions: string[];
  summary: string;
  evaluatedAt: string;
  rulesetVersion: string;
  modelConfidence?: number;
  modelVersion?: string;
  modelEvaluation?: Record<string, unknown>;
  modelReviewRequired?: boolean;
  /** 命中的前置过滤器代码；非空表示该记录是过滤器拦截记录而非 JEV 评分。 */
  filterCode?: string;
  knowledgeUsed?: string[];
  knowledgeQuestions?: string[];
  priceReferenceUsed?: Record<string, unknown>;
  /** true 表示线索已入库但 JEV 评分尚未完成（占位记录，不会落库）。 */
  pending?: boolean;
  pendingReason?: "price-reference-changed";
}

export interface KnowledgeEntry {
  id: string;
  entryType: "identification" | "seller-signal" | "pricing" | "question" | "case";
  category: Category;
  brand?: string;
  model?: string;
  title: string;
  summary: string;
  confidence: "draft" | "reviewed" | "verified";
  version: number;
  sourceLabel: string;
  updatedAt: string;
  usageCount: number;
  active?: boolean;
  effectChannel?: "jev-context" | "manual-only";
  reviewStatus?: "pending" | "approved";
  sourceType?: "manual" | "ai-assisted" | "feedback-event";
}

export interface MonitorTask {
  id: string;
  name: string;
  category: Category;
  keywords: string[];
  regions: string[];
  priceMin?: number;
  priceMax?: number;
  enabled: boolean;
  lastScanAt?: string;
  latestWatermark?: string;
}
