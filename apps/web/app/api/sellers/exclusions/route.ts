import { adminApiError } from "@/src/server/auth/admin-request";
import { listExclusions, loadObservationEvidence } from "@/src/server/exclusions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;

  try {
    const rows = await listExclusions();
    const evidence = await loadObservationEvidence(rows.map((row) => row.identityKey));
    return Response.json({
      ok: true,
      exclusions: rows.map((row) => ({
        id: row.id,
        identityKey: row.identityKey,
        identityType: row.identityType,
        nickname: row.nickname,
        area: row.area,
        source: row.source,
        reason: row.reason,
        ruleVersion: row.ruleVersion,
        status: row.status,
        hitCount: row.hitCount,
        evidence: row.evidence,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        revokeNote: row.revokeNote,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        observation: evidence.get(row.identityKey) ?? null,
      })),
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "排除记录读取失败。";
    return Response.json({ error: message }, { status: 500 });
  }
}
