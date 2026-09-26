import type { Metadata } from "next";
import { ExclusionManager, type ExclusionRowView } from "@/components/exclusion-manager";
import { requireAdminPage } from "@/src/server/auth/admin-request";
import { listExclusions, loadObservationEvidence } from "@/src/server/exclusions";

export const metadata: Metadata = { title: "排除管理" };

export const dynamic = "force-dynamic";

export default async function ExclusionsPage() {
  await requireAdminPage();
  let rows: ExclusionRowView[] = [];
  let loadError: string | null = null;
  try {
    const exclusions = await listExclusions();
    const evidence = await loadObservationEvidence(exclusions.map((row) => row.identityKey));
    rows = exclusions.map((row) => ({
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
      observation: evidence.get(row.identityKey)
        ? {
          distinctItemCount: evidence.get(row.identityKey)!.distinctItemCount,
          firstSeenAt: evidence.get(row.identityKey)!.firstSeenAt?.toISOString() ?? null,
          lastSeenAt: evidence.get(row.identityKey)!.lastSeenAt?.toISOString() ?? null,
          sampleTitles: evidence.get(row.identityKey)!.sampleTitles,
        }
        : null,
    }));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "排除记录读取失败。";
  }

  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header">
        <div>
          <p className="context-line">统一排除记录 · 采集器与工作台共用 · 撤销保留审计</p>
          <h1>排除管理</h1>
          <p>人工拉黑与规则自动排除都在这里；人工排除不被模型或自动规则覆盖。</p>
        </div>
      </header>
      {loadError ? (
        <div className="feedback-notice" data-kind="error" role="alert">{loadError}</div>
      ) : (
        <ExclusionManager rows={rows} />
      )}
    </div>
  );
}
