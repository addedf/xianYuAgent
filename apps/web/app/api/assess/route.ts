import { z } from "zod";
import { assessListing } from "@/src/domain/scoring";
import { adminApiError } from "@/src/server/auth/admin-request";

const listingSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().min(1),
  platform: z.enum(["xianyu", "demo"]),
  category: z.enum(["watch", "bag", "jewelry"]),
  brand: z.string().min(1),
  model: z.string().optional(),
  title: z.string().min(1),
  description: z.string(),
  price: z.number().nonnegative(),
  marketReferencePrice: z.number().positive().optional(),
  region: z.string().min(1),
  distanceKm: z.number().nonnegative().optional(),
  publishedAt: z.iso.datetime({ offset: true }),
  firstSeenAt: z.iso.datetime({ offset: true }),
  imageUrls: z.array(z.url()),
  duplicateImageCount: z.number().int().nonnegative(),
  hasSerialDetail: z.boolean(),
  hasPurchaseProof: z.boolean(),
  hasAccessoryDescription: z.boolean(),
  monitorKeywords: z.array(z.string().min(1)).min(1),
  sourceUrl: z.url().optional(),
  seller: z.object({
    externalId: z.string().min(1),
    displayName: z.string(),
    region: z.string(),
    activeListingCount: z.number().int().nonnegative(),
    sameCategoryRatio: z.number().min(0).max(1),
    templateSimilarity: z.number().min(0).max(1),
    hasPersonalStorySignals: z.boolean(),
    hasNaturalSceneSignals: z.boolean(),
    accountAgeDays: z.number().int().nonnegative().optional(),
  }),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  const payload = listingSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return Response.json({ error: "商品数据格式不正确。", issues: payload.error.issues }, { status: 400 });
  }

  return Response.json({ assessment: assessListing(payload.data) });
}
