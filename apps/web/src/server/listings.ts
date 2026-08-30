import { desc, eq } from "drizzle-orm";
import type { Category, MarketplaceListing } from "@/src/domain/listing";
import { assessListing } from "@/src/domain/scoring";
import { getDatabase } from "@/src/server/db/client";
import { marketplaceListings, sellers } from "@/src/server/db/schema";

const categories = new Set<Category>(["watch", "bag", "jewelry"]);

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function loadLatestAssessedListings(limit = 80) {
  const { db } = getDatabase();
  const rows = await db
    .select({
      listing: marketplaceListings,
      sellerExternalId: sellers.externalId,
      sellerDisplayName: sellers.displayName,
      sellerRegion: sellers.region,
    })
    .from(marketplaceListings)
    .leftJoin(sellers, eq(marketplaceListings.sellerId, sellers.id))
    .orderBy(desc(marketplaceListings.firstSeenAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => {
    const rawPayload = asRecord(row.listing.rawPayload);
    const category = categories.has(row.listing.category as Category) ? (row.listing.category as Category) : "bag";
    const listing: MarketplaceListing = {
      id: row.listing.id,
      externalId: row.listing.externalId,
      platform: "xianyu",
      category,
      brand: row.listing.brand || "待识别品牌",
      model: row.listing.model || undefined,
      title: row.listing.title,
      description: row.listing.description,
      price: Number(row.listing.price),
      region: row.listing.region || "地区未知",
      publishedAt: row.listing.publishedAt?.toISOString() ?? new Date(0).toISOString(),
      firstSeenAt: row.listing.firstSeenAt.toISOString(),
      imageUrls: asStringArray(row.listing.imageRefs),
      duplicateImageCount: 0,
      hasSerialDetail: false,
      hasPurchaseProof: false,
      hasAccessoryDescription: false,
      monitorKeywords: asStringArray(rawPayload.monitorKeywords).length > 0 ? asStringArray(rawPayload.monitorKeywords) : [row.listing.brand || row.listing.title],
      sourceUrl: row.listing.sourceUrl || undefined,
      seller: {
        externalId: row.sellerExternalId || `unknown-${row.listing.externalId}`,
        displayName: row.sellerDisplayName || (typeof rawPayload.sellerName === "string" ? rawPayload.sellerName : "匿名卖家"),
        region: row.sellerRegion || row.listing.region || "地区未知",
        activeListingCount: 6,
        sameCategoryRatio: 0,
        templateSimilarity: 0,
        hasPersonalStorySignals: false,
        hasNaturalSceneSignals: false,
      },
    };

    return { listing, assessment: assessListing(listing) };
  });
}
