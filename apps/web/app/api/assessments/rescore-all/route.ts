import { desc } from "drizzle-orm";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { assessments, marketplaceListings } from "@/src/server/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;

  try {
    const { db } = getDatabase();
    const listings = await db.select({ id: marketplaceListings.id }).from(marketplaceListings).orderBy(desc(marketplaceListings.firstSeenAt));
    const assessedRows = listings.length > 0
      ? await db.selectDistinct({ listingId: assessments.listingId }).from(assessments)
      : [];
    const assessedIds = new Set(assessedRows.map((row) => row.listingId));
    return Response.json({ listingIds: listings.map((listing) => listing.id), total: listings.length, previouslyAssessed: assessedIds.size });
  } catch {
    return Response.json({ error: "读取待重评分商品失败，请检查数据库连接。" }, { status: 503 });
  }
}
