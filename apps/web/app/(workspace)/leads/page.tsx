import type { Metadata } from "next";
import { LeadWorkbench } from "@/components/lead-workbench";
import { RescoreAllButton } from "@/components/rescore-all-button";
import { XianyuAuthRequiredNotice } from "@/components/xianyu-auth-required-notice";
import { assessedDemoListings } from "@/src/data/demo";
import { getServerEnv, isDemoMode } from "@/src/server/env";
import { checkTypesafe } from "@/src/server/health";
import { loadLatestAssessedListings } from "@/src/server/listings";
import { loadSellerRuleSettings } from "@/src/server/seller-rule-settings";
import { getXianyuAuthStatus } from "@/src/server/sources/xianyu-auth";

export const metadata: Metadata = { title: "线索审阅" };

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const demoMode = isDemoMode();
  let loadError = false;
  let authRequired = false;
  let authCheckError = false;
  let jevPausedNotice: string | null = null;
  let items = assessedDemoListings;
  let sellerThresholds = undefined;

  if (!demoMode) {
    const [listingsResult, authResult, jevResult, sellerRulesResult] = await Promise.allSettled([
      loadLatestAssessedListings(80, undefined, true),
      getXianyuAuthStatus({ env: getServerEnv() }),
      checkTypesafe(),
      loadSellerRuleSettings(),
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

    // JEV 暂停时不阻塞线索查看：待评分线索照常入库展示，恢复后自动补评。
    if (jevResult.status === "fulfilled" && jevResult.value.state !== "ready") {
      jevPausedNotice = jevResult.value.detail;
    } else if (jevResult.status === "rejected") {
      jevPausedNotice = "无法确认 JEV 评分服务状态，请到连接与控制页面检查配置。";
    }
    if (sellerRulesResult.status === "fulfilled") sellerThresholds = sellerRulesResult.value.thresholds;
  }

  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header page-header-split">
        <div>
          <p className="context-line">{demoMode ? "演示数据" : "PostgreSQL 真实数据"} · 证据优先 · 人工最终确认</p>
          <h1>线索审阅</h1>
          <p>把商品、卖家、风险依据和经验反馈放在同一视图中，避免只看一个总分。</p>
        </div>
        <RescoreAllButton demoMode={demoMode} />
      </header>
      {jevPausedNotice && (
        <div className="notice-state" role="status">JEV 评分已暂停：未评分线索显示为「待模型评分」，评分恢复后的下一次扫描会自动补评。{jevPausedNotice}</div>
      )}
      {authRequired && (
        <XianyuAuthRequiredNotice message="当前线索库只会显示已经入库的内容，无法获取新的闲鱼商品。完成扫码或官方窗口登录后，请在“连接与控制”中执行搜索并导入。" />
      )}
      {authCheckError && (
        <div className="error-state" role="alert">无法确认闲鱼登录状态，请先到“连接与控制”检查采集器并完成账号连接。</div>
      )}
      {loadError && <div className="error-state" role="alert">无法读取 PostgreSQL 线索，请先到“连接”页面检查数据库配置。</div>}
      <LeadWorkbench items={items} demoMode={demoMode} confidenceThreshold={demoMode ? undefined : getServerEnv().TYPESAFE_CONFIDENCE_THRESHOLD} sellerThresholds={sellerThresholds} />
    </div>
  );
}
