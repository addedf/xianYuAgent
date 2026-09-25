import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { knowledgeEntries, knowledgeVersions } from "@/src/server/db/schema";

export const runtime = "nodejs";

const entryTypeSchema = z.enum(["identification", "seller-signal", "pricing", "question", "case"]);
const categorySchema = z.enum(["watch", "bag", "jewelry", "other"]);
const confidenceSchema = z.enum(["draft", "reviewed", "verified"]);
const effectChannelSchema = z.enum(["jev-context", "manual-only"]);
const createSchema = z.object({
  entryType: entryTypeSchema,
  category: categorySchema,
  brand: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(4000),
  changeReason: z.string().trim().min(1).max(500),
  effectChannel: effectChannelSchema.optional(),
  sourceType: z.enum(["manual", "ai-assisted"]).optional(),
});
const updateSchema = z.object({
  id: z.uuid(),
  approve: z.boolean().optional(),
  entryType: entryTypeSchema.optional(),
  category: categorySchema.optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  confidence: confidenceSchema.optional(),
  active: z.boolean().optional(),
  effectChannel: effectChannelSchema.optional(),
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
        model: payload.model || null,
        title: payload.title,
        currentSummary: payload.summary,
        confidence: "draft",
        effectChannel: payload.entryType === "case" ? "manual-only" : payload.effectChannel ?? "jev-context",
        reviewStatus: "pending",
        currentVersion: 1,
        sourceLabel: payload.sourceType === "ai-assisted" ? "AI 辅助补充 · 待人工复核" : "人工维护 · 待复核",
      }).returning();
      await tx.insert(knowledgeVersions).values({
        knowledgeEntryId: created.id,
        version: 1,
        content: { entryType: payload.entryType, category: payload.category, brand: payload.brand || null, model: payload.model || null, title: payload.title, summary: payload.summary, effectChannel: payload.entryType === "case" ? "manual-only" : payload.effectChannel ?? "jev-context" },
        changeReason: payload.changeReason,
        sourceType: payload.sourceType ?? "manual",
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
      if (payload.approve && (payload.entryType !== undefined || payload.category !== undefined || payload.brand !== undefined || payload.model !== undefined || payload.title !== undefined || payload.summary !== undefined || payload.confidence !== undefined || payload.active !== undefined || payload.effectChannel !== undefined)) throw new Error("INVALID_APPROVAL");
      const updatedContent = {
        entryType: payload.entryType ?? current.entryType,
        category: payload.category ?? current.category,
        brand: payload.brand === undefined ? current.brand : payload.brand || null,
        model: payload.model === undefined ? current.model : payload.model || null,
        title: payload.title ?? current.title,
        summary: payload.summary ?? current.currentSummary,
        effectChannel: payload.effectChannel ?? current.effectChannel,
      };
      if (updatedContent.entryType === "case" && updatedContent.effectChannel === "jev-context") throw new Error("INVALID_CASE_CHANNEL");
      const contentChanged = updatedContent.entryType !== current.entryType
        || updatedContent.category !== current.category
        || updatedContent.brand !== current.brand
        || updatedContent.model !== current.model
        || updatedContent.title !== current.title
        || updatedContent.summary !== current.currentSummary
        || updatedContent.effectChannel !== current.effectChannel
        || (payload.confidence !== undefined && payload.confidence !== current.confidence);
      const active = payload.active ?? current.active;
      const activeChanged = active !== current.active;
      if ((contentChanged || activeChanged || payload.approve) && !payload.changeReason) throw new Error("CHANGE_REASON_REQUIRED");
      if (payload.approve && (!current.active || current.effectChannel === "jev-context" && current.entryType === "case")) throw new Error("INVALID_APPROVAL");
      const changed = contentChanged || activeChanged || Boolean(payload.approve);
      const version = current.currentVersion + (changed ? 1 : 0);
      const reviewStatus = payload.approve ? "approved" : changed ? "pending" : current.reviewStatus;
      const [updated] = await tx.update(knowledgeEntries).set({
        entryType: updatedContent.entryType,
        category: updatedContent.category,
        brand: updatedContent.brand,
        model: updatedContent.model,
        title: updatedContent.title,
        currentSummary: updatedContent.summary,
        effectChannel: updatedContent.effectChannel,
        confidence: payload.approve && current.confidence === "draft" ? "reviewed" : payload.confidence ?? current.confidence,
        reviewStatus,
        sourceLabel: payload.approve ? current.sourceLabel.replace(" · 待人工复核", "").replace(" · 待复核", "") : current.sourceLabel,
        currentVersion: version,
        active,
        updatedAt: new Date(),
      }).where(eq(knowledgeEntries.id, current.id)).returning();
      if (changed) {
        await tx.insert(knowledgeVersions).values({
          knowledgeEntryId: current.id,
          version,
          content: { ...updatedContent, active, confidence: payload.approve && current.confidence === "draft" ? "reviewed" : payload.confidence ?? current.confidence, reviewStatus },
          changeReason: payload.changeReason!,
          sourceType: "manual",
          approvedBy: payload.approve ? "local-user" : null,
          approvedAt: payload.approve ? new Date() : null,
        });
      }
      return updated;
    });
    return Response.json({ ok: true, entry: entryView(entry) });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "知识内容不正确。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "NOT_FOUND") return Response.json({ error: "没有找到这条知识。" }, { status: 404 });
    if (reason instanceof Error && reason.message === "CHANGE_REASON_REQUIRED") return Response.json({ error: "修改知识内容或状态时请填写修改原因。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "INVALID_APPROVAL") return Response.json({ error: "请先保存有效知识草稿，再单独批准生效。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "INVALID_CASE_CHANNEL") return Response.json({ error: "案例只能供人工查阅，不能直接注入 JEV。" }, { status: 400 });
    return Response.json({ error: "知识更新失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}

function entryView(entry: typeof knowledgeEntries.$inferSelect) {
  return {
    id: entry.id,
    entryType: entry.entryType,
    category: entry.category,
    brand: entry.brand || undefined,
    model: entry.model || undefined,
    title: entry.title,
    summary: entry.currentSummary,
    confidence: entry.confidence,
    version: entry.currentVersion,
    sourceLabel: entry.sourceLabel,
    updatedAt: entry.updatedAt.toISOString(),
    usageCount: 0,
    active: entry.active,
    effectChannel: entry.effectChannel,
    reviewStatus: entry.reviewStatus,
    sourceType: entry.sourceLabel.startsWith("AI") ? "ai-assisted" : "manual",
  };
}
