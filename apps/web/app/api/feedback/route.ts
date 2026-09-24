import { ZodError, z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { getDatabase } from "@/src/server/db/client";
import { feedbackEvents } from "@/src/server/db/schema";

export const runtime = "nodejs";

const feedbackSchema = z.object({
  listingId: z.uuid(),
  assessmentId: z.uuid().optional(),
  feedbackType: z.enum(["manual-feedback", "rule-candidate"]),
  reason: z.string().trim().min(1, "请填写反馈内容。" ).max(4000, "反馈内容不能超过 4000 个字符。"),
  finalLabel: z.string().trim().max(80).optional(),
  knowledgeCandidate: z.record(z.string(), z.unknown()).optional(),
  actualAcquisitionPrice: z.number().nonnegative().optional(),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = feedbackSchema.parse(await request.json().catch(() => null));
    const { db } = getDatabase();
    const [event] = await db.insert(feedbackEvents).values({
      listingId: payload.listingId,
      assessmentId: payload.assessmentId,
      feedbackType: payload.feedbackType,
      finalLabel: payload.finalLabel || null,
      reason: payload.reason,
      actualAcquisitionPrice: payload.actualAcquisitionPrice?.toString(),
      knowledgeCandidate: payload.knowledgeCandidate,
      promotionStatus: payload.feedbackType === "rule-candidate" ? "proposed" : "not-proposed",
    }).returning({ id: feedbackEvents.id });

    return Response.json({ ok: true, feedbackId: event.id });
  } catch (reason) {
    if (reason instanceof ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "反馈内容不正确。", issues: reason.issues }, { status: 400 });
    }
    return Response.json({ error: "反馈保存失败，请检查数据库连接后重试。" }, { status: 500 });
  }
}
