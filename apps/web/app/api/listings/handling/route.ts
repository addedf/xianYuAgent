import { z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { marketplaceListings } from "@/src/server/db/schema";
import { setListingHandling } from "@/src/server/exclusions";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const handlingSchema = z.object({
  listingId: z.uuid(),
  handling: z.enum(["ignored", "pending", "watched", "none"]),
  note: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = handlingSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const [listing] = await db
      .select({ externalId: marketplaceListings.externalId })
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.platform, "xianyu"), eq(marketplaceListings.id, payload.listingId)))
      .limit(1);
    if (!listing) {
      return Response.json({ error: "未找到该线索记录。" }, { status: 404 });
    }
    const result = await setListingHandling({
      externalId: listing.externalId,
      handling: payload.handling === "none" ? null : payload.handling,
      note: payload.note,
    });
    return Response.json({ ok: true, state: result, handling: payload.handling === "none" ? null : payload.handling });
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "处理状态参数不正确。" }, { status: 400 });
    }
    const message = reason instanceof Error ? reason.message : "处理状态保存失败，请检查数据库连接后重试。";
    return Response.json({ error: message }, { status: 500 });
  }
}
