"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Prohibit } from "@phosphor-icons/react";
import { exclusionReasonLabel, identityTypeLabel } from "@/src/domain/seller-identity";

export interface ExclusionRowView {
  id: string;
  identityKey: string;
  identityType: string;
  nickname: string;
  area: string;
  source: "manual" | "auto-rule";
  reason: string;
  ruleVersion: string | null;
  status: "active" | "revoked";
  hitCount: number;
  evidence: Record<string, unknown>;
  revokedAt: string | null;
  revokeNote: string | null;
  createdAt: string;
  updatedAt: string;
  observation: { distinctItemCount: number; firstSeenAt: string | null; lastSeenAt: string | null; sampleTitles: string[] } | null;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function ExclusionManager({ rows }: { rows: ExclusionRowView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function revoke(row: ExclusionRowView) {
    if (busyId) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const response = await fetch("/api/sellers/exclusions/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exclusionId: row.id, note: `工作台撤销（${new Date().toLocaleString("zh-CN", { hour12: false })}）` }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "撤销失败，请重试。");
      setNotice({ kind: "success", text: `已撤销「${row.nickname}」的排除记录；审计历史保留。该卖家商品恢复后仍需通过当前有效规则筛选，不会批量重新提醒。` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "撤销失败，请重试。" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        还没有排除记录。拉黑卖家或采集器自动排除命中后，会在这里出现并可撤销。
      </div>
    );
  }

  const activeRows = rows.filter((row) => row.status === "active");
  const revokedRows = rows.filter((row) => row.status === "revoked");

  return (
    <div className="page-stack">
      {notice && <div className="feedback-notice" data-kind={notice.kind} role="status">{notice.text}</div>}
      <section className="panel" aria-label="生效中的排除">
        <div className="section-heading">
          <div>
            <h2>生效中（{activeRows.length}）</h2>
            <p>这些卖家的商品在导入前即被拦截；撤销后仍需通过当前有效规则，不会批量重新提醒。</p>
          </div>
        </div>
        {activeRows.length === 0 ? (
          <p className="complete-message">当前没有生效中的排除。</p>
        ) : (
          <div className="exclusion-table" role="table" aria-label="生效中的排除记录">
            <div className="exclusion-row exclusion-row-head" role="row">
              <span role="columnheader">卖家 / 身份</span>
              <span role="columnheader">来源与原因</span>
              <span role="columnheader">观察与拦截</span>
              <span role="columnheader">操作</span>
            </div>
            {activeRows.map((row) => (
              <div className="exclusion-row" role="row" key={row.id}>
                <div role="cell">
                  <strong>{row.nickname || "（空昵称）"}</strong>
                  <small>{row.area || "地区未知"}</small>
                  <small>{identityTypeLabel(row.identityType)} · {row.identityKey}</small>
                  {row.identityType !== "stable" && <small className="exclusion-scope-note">弱身份：同昵称同地区一并拦截；改名后需重新发现。</small>}
                </div>
                <div role="cell">
                  <span className="seller-type-tag">{row.source === "manual" ? "人工拉黑" : "规则自动"}</span>
                  <small>{exclusionReasonLabel(row.reason)}{row.ruleVersion ? ` · ${row.ruleVersion}` : ""}</small>
                  <small>建立于 {formatTime(row.createdAt)}</small>
                </div>
                <div role="cell">
                  <small>累计拦截商品 {row.hitCount} 件</small>
                  <small>观察索引：{row.observation ? `${row.observation.distinctItemCount} 件不同商品` : "暂无记录"}</small>
                  {row.observation?.sampleTitles.slice(0, 2).map((title) => <small key={title} className="exclusion-sample" title={title}>{title}</small>)}
                </div>
                <div role="cell">
                  <button className="button button-secondary button-small" type="button" onClick={() => revoke(row)} disabled={busyId === row.id}>
                    <Prohibit size={15} aria-hidden="true" />
                    {busyId === row.id ? "撤销中…" : "撤销排除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {revokedRows.length > 0 && (
        <section className="panel" aria-label="已撤销的排除">
          <div className="section-heading">
            <div>
              <h2>已撤销（{revokedRows.length}）</h2>
              <p>撤销只是状态变化：审计历史、证据与命中计数继续保留。人工拉黑撤销后不会被自动规则原样复活。</p>
            </div>
          </div>
          <div className="exclusion-table" role="table" aria-label="已撤销的排除记录">
            {revokedRows.map((row) => (
              <div className="exclusion-row exclusion-row-revoked" role="row" key={row.id}>
                <div role="cell">
                  <strong>{row.nickname || "（空昵称）"}</strong>
                  <small>{identityTypeLabel(row.identityType)} · {row.identityKey}</small>
                </div>
                <div role="cell">
                  <small>{exclusionReasonLabel(row.reason)}</small>
                  <small>撤销于 {formatTime(row.revokedAt)}{row.revokeNote ? ` · ${row.revokeNote}` : ""}</small>
                </div>
                <div role="cell">
                  <small>历史拦截 {row.hitCount} 件</small>
                </div>
                <div role="cell">
                  {row.evidence.userRevoked === true
                    ? <small>用户撤销：自动规则不再原样复活；如需再拦截请人工拉黑。</small>
                    : <small>满足规则时可能重新生效。</small>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
