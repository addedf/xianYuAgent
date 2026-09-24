import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { knowledgeEntries, knowledgeVersions } from "@/src/server/db/schema";

export const runtime = "nodejs";

const entryTypeSchema = z.enum(["identification", "seller-signal", "pricing", "question", "case"]);
const categorySchema = z.enum(["watch", "bag", "jewelry"]);
const confidenceSchema = z.enum(["draft", "reviewed", "verified"]);
const createSchema = z.object({
  entryType: entryTypeSchema,
  category: categorySchema,
  brand: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(4000),
  changeReason: z.string().trim().min(1).max(500),
});
const updateSchema = z.object({
  id: z.uuid(),
  entryType: entryTypeSchema.optional(),
  category: categorySchema.optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  confidence: confidenceSchema.optional(),
  active: z.boolean().optional(),
  changeReason: z.string().trim().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = createSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const entry = await db.transaction(async (tx) => {
      const [created] = await tx.insert(knowledgeEntries).values({
        entryType: payload.entryType,
        category: payload.category,
        brand: payload.brand || null,
        title: payload.title,
        currentSummary: payload.summary,
        confidence: "draft",
        reviewStatus: "pending",
        currentVersion: 1,
        sourceLabel: "人工维护",
      }).returning();
      await tx.insert(knowledgeVersions).values({
        knowledgeEntryId: created.id,
        version: 1,
        content: { entryType: payload.entryType, category: payload.category, brand: payload.brand || null, title: payload.title, summary: payload.summary },
        changeReason: payload.changeReason,
        sourceType: "manual",
        approvedBy: "local-user",
      });
      return created;
    });
    return Response.json({ ok: true, entry: entryView(entry) }, { status: 201 });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "知识内容不正确。" }, { status: 400 });
    return Response.json({ error: "知识保存失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = updateSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const entry = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, payload.id)).limit(1).for("update");
      if (!current) throw new Error("NOT_FOUND");
      const updatedContent = {
        entryType: payload.entryType ?? current.entryType,
        category: payload.category ?? current.category,
        brand: payload.brand === undefined ? current.brand : payload.brand || null,
        title: payload.title ?? current.title,
        summary: payload.summary ?? current.currentSummary,
      };
      const contentChanged = updatedContent.entryType !== current.entryType
        || updatedContent.category !== current.category
        || updatedContent.brand !== current.brand
        || updatedContent.title !== current.title
        || updatedContent.summary !== current.currentSummary
        || (payload.confidence !== undefined && payload.confidence !== current.confidence);
      const active = payload.active ?? current.active;
      const activeChanged = active !== current.active;
      if ((contentChanged || activeChanged) && !payload.changeReason) throw new Error("CHANGE_REASON_REQUIRED");
      const version = current.currentVersion + (contentChanged || activeChanged ? 1 : 0);
      const [updated] = await tx.update(knowledgeEntries).set({
        entryType: updatedContent.entryType,
        category: updatedContent.category,
        brand: updatedContent.brand,
        title: updatedContent.title,
        currentSummary: updatedContent.summary,
        confidence: payload.confidence ?? current.confidence,
        currentVersion: version,
        active,
        updatedAt: new Date(),
      }).where(eq(knowledgeEntries.id, current.id)).returning();
      if (contentChanged || activeChanged) {
        await tx.insert(knowledgeVersions).values({
          knowledgeEntryId: current.id,
          version,
          content: { ...updatedContent, active },
          changeReason: payload.changeReason!,
          sourceType: "manual",
          approvedBy: "local-user",
        });
      }
      return updated;
    });
    return Response.json({ ok: true, entry: entryView(entry) });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "知识内容不正确。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "NOT_FOUND") return Response.json({ error: "没有找到这条知识。" }, { status: 404 });
    if (reason instanceof Error && reason.message === "CHANGE_REASON_REQUIRED") return Response.json({ error: "修改知识内容或状态时请填写修改原因。" }, { status: 400 });
    return Response.json({ error: "知识更新失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}

function entryView(entry: typeof knowledgeEntries.$inferSelect) {
  return {
    id: entry.id,
    entryType: entry.entryType,
    category: entry.category,
    brand: entry.brand || undefined,
    title: entry.title,
    summary: entry.currentSummary,
    confidence: entry.confidence,
    version: entry.currentVersion,
    sourceLabel: entry.sourceLabel,
    updatedAt: entry.updatedAt.toISOString(),
    usageCount: 0,
    active: entry.active,
  };
}
