import { z } from "zod";
import { adminApiError } from "@/src/server/auth/admin-request";
import { revokeExclusion } from "@/src/server/exclusions";

export const runtime = "nodejs";

const revokeSchema = z.object({
  exclusionId: z.uuid(),
  note: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const guard = adminApiError(request, true);
  if (guard) return guard;

  try {
    const payload = revokeSchema.parse(await request.json().catch(() => null));
    const row = await revokeExclusion(payload.exclusionId, payload.note);
    return Response.json({ ok: true, exclusion: { id: row.id, identityKey: row.identityKey, status: row.status } });
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "撤销参数不正确。" }, { status: 400 });
    }
    const message = reason instanceof Error ? reason.message : "撤销失败，请检查数据库连接后重试。";
    const status = message.includes("不存在") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
