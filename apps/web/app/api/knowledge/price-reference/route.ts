import { and, desc, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { isPriceReferenceEligible } from "@/src/domain/price-reference";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { marketPriceReferences, marketplaceListings } from "@/src/server/db/schema";

export const runtime = "nodejs";

const createSchema = z.object({
  listingId: z.uuid().nullable().optional(),
  category: z.enum(["watch", "bag", "jewelry", "other"]),
  brand: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.string().trim().length(3).default("CNY"),
  priceType: z.enum(["actual_sale", "asking", "buyback_quote", "estimated_resale", "retail_msrp"]),
  conditionGrade: z.enum(["new", "near_new", "good", "fair", "unknown"]),
  productionYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  accessories: z.array(z.string().trim().min(1).max(80)).max(30),
  market: z.enum(["CN-mainland", "other"]),
  marketRegion: z.string().trim().max(80).optional(),
  conditionNote: z.string().trim().min(3).max(500),
  sourceLabel: z.string().trim().min(1).max(120),
  sourceUrl: z.url().refine((value) => value.startsWith("https://"), "来源链接需使用 HTTPS。").optional(),
  sampleEvidence: z.array(z.object({ sourceLabel: z.string().trim().min(1).max(120), amount: z.number().positive().max(1_000_000_000), observedAt: z.iso.date() })).min(1).max(50),
  observedAt: z.iso.datetime({ offset: true }),
  changeReason: z.string().trim().min(1).max(500),
  origin: z.enum(["manual", "ai-assisted"]).default("manual"),
});
const reviewSchema = z.object({ id: z.uuid(), action: z.enum(["approve", "disable"]), changeReason: z.string().trim().min(1).max(500) });

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  try {
    const payload = createSchema.parse(await request.json().catch(() => null));
    if (new Date(payload.observedAt).getTime() > Date.now()) return Response.json({ error: "观察时间不能晚于当前时间。" }, { status: 400 });
    if (new Set(payload.sampleEvidence.map((sample) => sample.sourceLabel.toLocaleLowerCase())).size !== payload.sampleEvidence.length)
      return Response.json({ error: "逐条样本的来源或匿名成交编号不能重复。" }, { status: 400 });
    if (payload.sampleEvidence.some((sample) => new Date(`${sample.observedAt}T23:59:59.999Z`).getTime() < new Date(payload.observedAt).getTime() - 90 * 86_400_000 || new Date(`${sample.observedAt}T00:00:00.000Z`).getTime() > Date.now()))
      return Response.json({ error: "样本日期需在本次观察前 90 天内，且不能晚于当前日期。" }, { status: 400 });
    const { db } = getDatabase();
    if (payload.listingId) {
      const [listing] = await db.select({ id: marketplaceListings.id, category: marketplaceListings.category, brand: marketplaceListings.brand, model: marketplaceListings.model })
        .from(marketplaceListings).where(eq(marketplaceListings.id, payload.listingId)).limit(1);
      if (!listing) return Response.json({ error: "未找到要关联的线索。" }, { status: 404 });
      if (listing.category !== payload.category || (listing.brand && listing.brand !== "待识别品牌" && listing.brand.trim().toLocaleLowerCase() !== payload.brand.toLocaleLowerCase()))
        return Response.json({ error: "参考价品类或品牌与线索不一致，请先核对商品身份。" }, { status: 400 });
      if (listing.model && listing.model.trim().toLocaleLowerCase() !== payload.model.toLocaleLowerCase())
        return Response.json({ error: "参考价型号与线索不一致，请先核对商品身份。" }, { status: 400 });
    }
    const scopeKey = payload.listingId ? `listing:${payload.listingId}` : `model:${payload.category}:${payload.brand.toLocaleLowerCase()}:${payload.model.toLocaleLowerCase()}`;
    const record = await db.transaction(async (tx) => {
      const [latest] = await tx.select({ version: marketPriceReferences.version }).from(marketPriceReferences)
        .where(eq(marketPriceReferences.scopeKey, scopeKey)).orderBy(desc(marketPriceReferences.version)).limit(1);
      const [created] = await tx.insert(marketPriceReferences).values({
        listingId: payload.listingId ?? null, scopeKey, category: payload.category, brand: payload.brand, model: payload.model,
        version: (latest?.version ?? 0) + 1, amount: String(payload.amount), currency: payload.currency.toUpperCase(),
        priceType: payload.priceType, matchedModel: payload.model, conditionGrade: payload.conditionGrade,
        productionYear: payload.productionYear ?? null, accessories: payload.accessories, market: payload.market,
        marketRegion: payload.marketRegion ?? null, conditionNote: payload.conditionNote,
        sourceLabel: payload.sourceLabel, sourceUrl: payload.sourceUrl ?? null, sampleCount: payload.sampleEvidence.length, sampleEvidence: payload.sampleEvidence,
        observedAt: new Date(payload.observedAt), status: "pending", changeReason: payload.changeReason, origin: payload.origin,
      }).returning();
      return created;
    });
    return Response.json({ ok: true, reference: { id: record.id, version: record.version, status: record.status, eligible: isPriceReferenceEligible(record) } }, { status: 201 });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "参考价内容不正确。" }, { status: 400 });
    return Response.json({ error: "参考价保存失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;
  try {
    const payload = reviewSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(marketPriceReferences).where(eq(marketPriceReferences.id, payload.id)).limit(1).for("update");
      if (!current) throw new Error("NOT_FOUND");
      if (payload.action === "approve") {
        if (current.status !== "pending") throw new Error("NOT_PENDING");
        const [latest] = await tx.select({ version: marketPriceReferences.version }).from(marketPriceReferences)
          .where(eq(marketPriceReferences.scopeKey, current.scopeKey)).orderBy(desc(marketPriceReferences.version)).limit(1);
        if (latest?.version !== current.version) throw new Error("NOT_LATEST");
        await tx.update(marketPriceReferences).set({ status: "approved", approvedBy: "local-user", approvedAt: new Date(), changeReason: `${current.changeReason}；批准：${payload.changeReason}` }).where(eq(marketPriceReferences.id, current.id));
        const applied = isPriceReferenceEligible(current);
        if (applied && current.listingId) await tx.update(marketplaceListings).set({
          marketReferencePrice: current.amount, marketReferenceId: current.id, marketReferenceVersion: current.version,
          marketReferenceExpiresAt: new Date(current.observedAt.getTime() + 90 * 86_400_000), updatedAt: new Date(),
        }).where(eq(marketplaceListings.id, current.listingId));
        return { status: "approved", applied };
      }
      const [latest] = await tx.select({ version: marketPriceReferences.version }).from(marketPriceReferences)
        .where(eq(marketPriceReferences.scopeKey, current.scopeKey)).orderBy(desc(marketPriceReferences.version)).limit(1);
      const nextVersion = (latest?.version ?? current.version) + 1;
      await tx.insert(marketPriceReferences).values({
        listingId: current.listingId, scopeKey: current.scopeKey, category: current.category, brand: current.brand, model: current.model,
        version: nextVersion, amount: current.amount, currency: current.currency, priceType: current.priceType,
        matchedModel: current.matchedModel, conditionGrade: current.conditionGrade, productionYear: current.productionYear,
        accessories: current.accessories, market: current.market, marketRegion: current.marketRegion,
        conditionNote: current.conditionNote, sourceLabel: current.sourceLabel,
        sourceUrl: current.sourceUrl, sampleCount: current.sampleCount, sampleEvidence: current.sampleEvidence, observedAt: current.observedAt,
        status: "disabled", changeReason: payload.changeReason, origin: "manual", approvedBy: "local-user", approvedAt: new Date(),
      });
      if (current.listingId) await tx.update(marketplaceListings).set({ marketReferencePrice: null, marketReferenceId: null, marketReferenceVersion: null, marketReferenceExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(marketplaceListings.id, current.listingId), eq(marketplaceListings.marketReferenceVersion, current.version)));
      return { status: "disabled", applied: false };
    });
    return Response.json({ ok: true, ...result });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "参考价操作不正确。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "NOT_FOUND") return Response.json({ error: "未找到这条参考价。" }, { status: 404 });
    if (reason instanceof Error && reason.message === "NOT_PENDING") return Response.json({ error: "仅待复核参考价可被批准。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "NOT_LATEST") return Response.json({ error: "这条参考价已有更新版本，请先复核最新版本。" }, { status: 409 });
    return Response.json({ error: "参考价状态更新失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}
