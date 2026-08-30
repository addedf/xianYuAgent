import type { Metadata } from "next";
import { LeadWorkbench } from "@/components/lead-workbench";
import { XianyuAuthRequiredNotice } from "@/components/xianyu-auth-required-notice";
import { assessedDemoListings } from "@/src/data/demo";
import { getServerEnv, isDemoMode } from "@/src/server/env";
import { loadLatestAssessedListings } from "@/src/server/listings";
import { getXianyuAuthStatus } from "@/src/server/sources/xianyu-auth";

export const metadata: Metadata = { title: "线索审阅" };

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const demoMode = isDemoMode();
  let loadError = false;
  let authRequired = false;
  let authCheckError = false;
  let items = assessedDemoListings;

  if (!demoMode) {
    const [listingsResult, authResult] = await Promise.allSettled([
      loadLatestAssessedListings(),
      getXianyuAuthStatus({ env: getServerEnv() }),
    ]);

    if (listingsResult.status === "fulfilled") {
      items = listingsResult.value;
    } else {
      items = [];
      loadError = true;
    }

    if (authResult.status === "fulfilled") {
      authRequired = !authResult.value.loggedIn;
    } else {
      authCheckError = true;
    }
  }

  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header">
        <p className="context-line">{demoMode ? "演示数据" : "PostgreSQL 真实数据"} · 证据优先 · 人工最终确认</p>
        <h1>线索审阅</h1>
        <p>把商品、卖家、风险依据和经验反馈放在同一视图中，避免只看一个总分。</p>
      </header>
      {authRequired && (
        <XianyuAuthRequiredNotice message="当前线索库只会显示已经入库的内容，无法获取新的闲鱼商品。完成扫码鉴权后，请在“连接与控制”中执行搜索并导入。" />
      )}
      {authCheckError && (
        <div className="error-state" role="alert">无法确认闲鱼登录状态，请先到“连接与控制”检查采集器并完成扫码鉴权。</div>
      )}
      {loadError && <div className="error-state" role="alert">无法读取 PostgreSQL 线索，请先到“连接”页面检查数据库配置。</div>}
      <LeadWorkbench items={items} demoMode={demoMode} />
    </div>
  );
}
