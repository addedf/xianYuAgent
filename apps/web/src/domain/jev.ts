export type JevDimension = "personalSeller" | "authenticityRisk" | "informationCompleteness";

export interface JevScore {
  score: number; // Normalized to 0–100; rubric indices are normalized only in the adapter.
  confidence: number; // 0–1
  probabilities: Record<string, number>;
  signal: string;
}

export interface JevEvaluation {
  modelVersion: string;
  scores: Record<JevDimension, JevScore>;
  sellerType: { choice: string; confidence: number; probabilities: Record<string, number> };
  counterfeitClaim: number;
  personalStory: number;
  raw: Record<string, unknown>;
  stateFingerprint: string;
  questionsVersion: string;
}
