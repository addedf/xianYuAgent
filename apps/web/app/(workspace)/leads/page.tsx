import type { Metadata } from "next";
import { LeadWorkbench } from "@/components/lead-workbench";
import { assessedDemoListings } from "@/src/data/demo";
import { isDemoMode } from "@/src/server/env";
import { loadLatestAssessedListings } from "@/src/server/listings";

export const metadata: Metadata = { title: "线索审阅" };

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const demoMode = isDemoMode();
  let loadError = false;
  let items = assessedDemoListings;

  if (!demoMode) {
    try {
      items = await loadLatestAssessedListings();
    } catch {
      items = [];
      loadError = true;
    }
  }

  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header">
        <p className="context-line">{demoMode ? "演示数据" : "PostgreSQL 真实数据"} · 证据优先 · 人工最终确认</p>
        <h1>线索审阅</h1>
        <p>把商品、卖家、风险依据和经验反馈放在同一视图中，避免只看一个总分。</p>
      </header>
      {loadError && <div className="error-state" role="alert">无法读取 PostgreSQL 线索，请先到“连接”页面检查数据库配置。</div>}
      <LeadWorkbench items={items} demoMode={demoMode} />
    </div>
  );
}
