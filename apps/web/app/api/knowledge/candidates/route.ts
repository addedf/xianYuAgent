import { and, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { feedbackEvents, knowledgeEntries, knowledgeVersions, marketplaceListings } from "@/src/server/db/schema";

export const runtime = "nodejs";

const payloadSchema = z.object({ feedbackId: z.uuid() });

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const { feedbackId } = payloadSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const entryId = await db.transaction(async (tx) => {
      const [candidate] = await tx.select({ feedback: feedbackEvents, listing: marketplaceListings })
        .from(feedbackEvents)
        .innerJoin(marketplaceListings, eq(feedbackEvents.listingId, marketplaceListings.id))
        .where(and(eq(feedbackEvents.id, feedbackId), eq(feedbackEvents.feedbackType, "rule-candidate"), eq(feedbackEvents.promotionStatus, "proposed")))
        .limit(1)
        .for("update");
      if (!candidate) throw new Error("NOT_FOUND");
      const rawCandidate = candidate.feedback.knowledgeCandidate && typeof candidate.feedback.knowledgeCandidate === "object" && !Array.isArray(candidate.feedback.knowledgeCandidate)
        ? candidate.feedback.knowledgeCandidate as Record<string, unknown>
        : {};
      const text = typeof rawCandidate.text === "string" && rawCandidate.text.trim() ? rawCandidate.text.trim() : candidate.feedback.reason || "";
      if (!text) throw new Error("EMPTY_CANDIDATE");
      const title = typeof rawCandidate.label === "string" && rawCandidate.label.trim()
        ? rawCandidate.label.trim().slice(0, 80)
        : candidate.feedback.finalLabel?.trim().slice(0, 80) || `线索经验：${candidate.listing.title}`.slice(0, 80);
      const category = ["watch", "bag", "jewelry"].includes(candidate.listing.category) ? candidate.listing.category : "watch";
      const [entry] = await tx.insert(knowledgeEntries).values({
        entryType: "case",
        category,
        title,
        currentSummary: text,
        confidence: "draft",
        reviewStatus: "pending",
        currentVersion: 1,
        sourceLabel: "人工规则候选",
      }).returning({ id: knowledgeEntries.id });
      await tx.insert(knowledgeVersions).values({
        knowledgeEntryId: entry.id,
        version: 1,
        content: { entryType: "case", category, title, summary: text, listingExternalId: candidate.listing.externalId },
        changeReason: "将人工提交的规则候选整理为待复核知识草稿。",
        sourceType: "feedback-event",
        sourceReference: candidate.feedback.id,
      });
      await tx.update(feedbackEvents).set({ promotionStatus: "promoted" }).where(eq(feedbackEvents.id, candidate.feedback.id));
      return entry.id;
    });
    return Response.json({ ok: true, entryId }, { status: 201 });
  } catch (reason) {
    if (reason instanceof ZodError) return Response.json({ error: reason.issues[0]?.message ?? "候选编号不正确。" }, { status: 400 });
    if (reason instanceof Error && reason.message === "NOT_FOUND") return Response.json({ error: "规则候选不存在或已处理。" }, { status: 404 });
    if (reason instanceof Error && reason.message === "EMPTY_CANDIDATE") return Response.json({ error: "候选缺少可保存的内容。" }, { status: 400 });
    return Response.json({ error: "候选保存失败，请检查数据库连接后重试。" }, { status: 503 });
  }
}
