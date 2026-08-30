export const CATEGORY_VALUES = ["watch", "bag", "jewelry"] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

export type EvidenceKind = "positive" | "risk" | "missing" | "neutral";
export type RiskLevel = "low" | "insufficient" | "medium" | "high";
export type RecommendedAction = "notify" | "review" | "archive" | "skip";

export interface SellerProfile {
  externalId: string;
  displayName: string;
  region: string;
  activeListingCount: number;
  sameCategoryRatio: number;
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
  seller: SellerProfile;
}

export interface AssessmentEvidence {
  code: string;
  kind: EvidenceKind;
  label: string;
  detail: string;
  scoreImpact: number;
  source: "rule" | "knowledge" | "market" | "seller";
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
}

export interface KnowledgeEntry {
  id: string;
  entryType: "identification" | "seller-signal" | "pricing" | "question" | "case";
  category: Category;
  brand?: string;
  title: string;
  summary: string;
  confidence: "draft" | "reviewed" | "verified";
  version: number;
  sourceLabel: string;
  updatedAt: string;
  usageCount: number;
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

