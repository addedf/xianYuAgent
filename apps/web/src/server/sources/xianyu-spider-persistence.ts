import { createHash } from "node:crypto";
import postgres from "postgres";
import type { MarketplaceListing } from "@/src/domain/listing";
import { assessListing } from "@/src/domain/scoring";
import { getDatabase } from "@/src/server/db/client";
import { assessments, marketplaceListings, sellers } from "@/src/server/db/schema";
import { parseSourceProduct, type SourceProduct, xianyuProductExternalId } from "./xianyu-spider";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function loadSourceProducts(ids: number[], databaseUrl: string): Promise<SourceProduct[]> {
  if (ids.length === 0) return [];
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 5, prepare: false });
  try {
    const rows = await client`
      select id, title, price, area, seller, link, image_url, publish_time
      from xianyu_products
      where id in ${client(ids)}
    `;
    return rows.map(parseSourceProduct);
  } catch {
    throw new Error("无法读取采集器的 xianyu_products 表，请确认采集器与 Web 使用同一本机 PostgreSQL 数据库。");
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

export async function saveListings(listings: MarketplaceListing[], sourceProducts: SourceProduct[]): Promise<number> {
  const { db } = getDatabase();
  let imported = 0;

  for (const listing of listings) {
    const sourceProduct = sourceProducts.find(
      (product) => xianyuProductExternalId(product.link, product.id) === listing.externalId,
    );
    const [seller] = await db
      .insert(sellers)
      .values({
        platform: "xianyu",
        externalId: listing.seller.externalId,
        displayName: listing.seller.displayName,
        region: listing.seller.region,
        profileSnapshot: { source: "xianyu-spider", completeness: "nickname-only" },
      })
      .onConflictDoUpdate({
        target: [sellers.platform, sellers.externalId],
        set: { displayName: listing.seller.displayName, region: listing.seller.region, lastSeenAt: new Date(), updatedAt: new Date() },
      })
      .returning({ id: sellers.id });

    const [inserted] = await db
      .insert(marketplaceListings)
      .values({
        platform: "xianyu",
        externalId: listing.externalId,
        sellerId: seller.id,
        category: listing.category,
        brand: listing.brand,
        model: listing.model,
        title: listing.title,
        description: listing.description,
        price: String(listing.price),
        region: listing.region,
        publishedAt: new Date(listing.publishedAt),
        firstSeenAt: new Date(listing.firstSeenAt),
        sourceUrl: listing.sourceUrl,
        imageRefs: listing.imageUrls,
        rawPayload: {
          collector: "xianyu-spider-compatible",
          sourceProductId: sourceProduct?.id,
          sellerName: listing.seller.displayName,
          monitorKeywords: listing.monitorKeywords,
        },
        contentFingerprint: fingerprint(`${listing.title}|${listing.price}|${listing.region}`),
      })
      .onConflictDoNothing({ target: [marketplaceListings.platform, marketplaceListings.externalId] })
      .returning({ id: marketplaceListings.id });

    if (!inserted) continue;

    const assessment = assessListing({ ...listing, id: inserted.id });
    await db.insert(assessments).values({
      listingId: inserted.id,
      rulesetVersion: assessment.rulesetVersion,
      riskLevel: assessment.riskLevel,
      recommendedAction: assessment.recommendedAction,
      totalOpportunity: assessment.scores.totalOpportunity,
      scores: assessment.scores,
      evidence: assessment.evidence,
      missingInformation: assessment.missingInformation,
      summary: assessment.summary,
      evaluatedAt: new Date(assessment.evaluatedAt),
    });
    imported += 1;
  }

  return imported;
}
