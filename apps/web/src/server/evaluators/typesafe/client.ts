import { TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { JevEvaluation, JevScore } from "@/src/domain/jev";
import type { ServerEnv } from "@/src/server/env";
import { QUESTIONS_VERSION, scoreRubrics, stateFingerprint, typesafeQuestions, type TypesafeState } from "./questions";

const probability = z.number().min(0).max(1);
function distribution(keys: readonly string[]) {
  return z.record(z.string(), probability).refine((value) =>
    Object.keys(value).length === keys.length && keys.every((key) => key in value) && Math.abs(Object.values(value).reduce((sum, p) => sum + p, 0) - 1) < 0.02,
  );
}
const scoreAnswer = z.object({
  type: z.literal("score"), score: z.number().min(0).max(4), confidence: probability,
  probabilities: distribution(["0", "1", "2", "3", "4"]),
  // Do not persist free-form upstream text: the rubric is known locally.
  legend: z.record(z.string(), z.string()),
});
const responseSchema = z.object({
  model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),
  answers: z.object({
    personalSellerScore: scoreAnswer, authenticityRiskScore: scoreAnswer, completenessScore: scoreAnswer,
    sellerType: z.object({ type: z.literal("choice"), choice: z.enum(["personal", "professional", "peer", "unclear"]), confidence: probability, probabilities: distribution(["personal", "professional", "peer", "unclear"]) }),
    counterfeitClaim: z.object({ type: z.literal("noul"), noul: probability }),
    personalStory: z.object({ type: z.literal("noul"), noul: probability }),
  }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

export function parseTypesafeResponse(payload: unknown, state: TypesafeState): JevEvaluation | null {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { answers } = parsed.data;
  // Validate the echoed rubric instead of retaining any arbitrary response text.
  for (const key of Object.keys(scoreRubrics) as Array<keyof typeof scoreRubrics>) {
    if (scoreRubrics[key].some((label, i) => answers[key].legend[String(i)] !== label)) return null;
  }
  const normalized = (key: keyof typeof scoreRubrics): JevScore => {
    const answer = answers[key];
    // 归一化用五档概率分布的期望值得到连续分数，比单点档位更平滑；
    // 模型给出的整数档位仍保留在 raw 中供审计。
    const expectedIndex = Object.entries(answer.probabilities).reduce((sum, [index, p]) => sum + Number(index) * p, 0);
    const best = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0][0];
    return { score: Math.round((expectedIndex / 4) * 100), confidence: answer.confidence, probabilities: answer.probabilities, signal: scoreRubrics[key][Number(best)] };
  };
  return {
    modelVersion: `${parsed.data.model}/sdk-0.6.0/q-${QUESTIONS_VERSION}`,
    questionsVersion: QUESTIONS_VERSION,
    stateFingerprint: stateFingerprint(state),
    scores: { personalSeller: normalized("personalSellerScore"), authenticityRisk: normalized("authenticityRiskScore"), informationCompleteness: normalized("completenessScore") },
    sellerType: answers.sellerType,
    counterfeitClaim: answers.counterfeitClaim.noul, personalStory: answers.personalStory.noul,
    raw: { ...parsed.data, stateFingerprint: stateFingerprint(state), questionsVersion: QUESTIONS_VERSION },
  };
}

export async function requestTypesafe(state: TypesafeState, env: ServerEnv, fetcher: typeof fetch = fetch): Promise<JevEvaluation | null> {
  try {
    const client = new TypeSafeClient({
      apiKey: env.TYPESAFE_API_KEY, baseURL: "https://api.typesafe.ai", defaultModel: "jev-latest",
      logLevel: "off", retry: { maxRetries: 0 }, timeout: env.TYPESAFE_TIMEOUT_MS,
      fetch: (url, init) => fetcher(url, { ...init, redirect: "error" }),
    });
    return parseTypesafeResponse(await client.systemOne({ state, questions: typesafeQuestions }), state);
  } catch {
    // Never log upstream error objects (which can contain request text or credentials).
    return null;
  }
}
