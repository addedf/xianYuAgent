import type { Metadata } from "next";
import { ArrowRight, CheckCircle, GitBranch, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { KnowledgeWorkbench } from "@/components/knowledge-workbench";
import { demoKnowledgeEntries } from "@/src/data/demo";
import { isDemoMode } from "@/src/server/env";
import { loadKnowledgeWorkbenchData } from "@/src/server/knowledge";

export const metadata: Metadata = { title: "经验知识库" };

export default async function KnowledgePage() {
  const demoMode = isDemoMode();
  let entries = demoMode ? demoKnowledgeEntries : [];
  let rules = [] as Awaited<ReturnType<typeof loadKnowledgeWorkbenchData>>["rules"];
  let candidates = [] as Awaited<ReturnType<typeof loadKnowledgeWorkbenchData>>["candidates"];
  let thresholds = { sameCategoryMinCount: 6, completedSaleMinCount: 100 };
  let loadError = false;
  if (!demoMode) {
    try {
      ({ entries, rules, candidates, thresholds } = await loadKnowledgeWorkbenchData());
    } catch {
      loadError = true;
    }
  }
  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header page-header-split">
        <div>
          <p className="context-line">结构化经验 · 人工批准 · 版本可回滚</p>
          <h1>经验知识库</h1>
          <p>把商品判断和成交反馈沉淀为可维护的鉴别点、卖家信号、价格经验、追问策略与案例。</p>
        </div>
        <div className="knowledge-stats" aria-label="知识库摘要">
          <div><strong>{entries.filter((entry) => entry.active !== false).length}</strong><span>当前条目</span></div>
          <div><strong>{candidates.length}</strong><span>待复核候选</span></div>
          <div><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>当前规则</span></div>
        </div>
      </header>

      <section className="learning-flow" aria-label="经验沉淀流程">
        <div><Sparkle size={20} weight="fill" /><span><strong>发现差异</strong><small>原判断与最终结果不一致</small></span></div>
        <ArrowRight size={17} className="flow-arrow" aria-hidden="true" />
        <div><GitBranch size={20} weight="fill" /><span><strong>生成候选</strong><small>保留商品、证据与纠正原因</small></span></div>
        <ArrowRight size={17} className="flow-arrow" aria-hidden="true" />
        <div><CheckCircle size={20} weight="fill" /><span><strong>人工批准</strong><small>发布新版本并保留旧规则</small></span></div>
      </section>

      {loadError && <div className="error-state" role="alert">无法读取 PostgreSQL 知识与规则，请先检查数据库连接。</div>}
      <KnowledgeWorkbench initialEntries={entries} initialRules={rules} initialCandidates={candidates} initialThresholds={thresholds} demoMode={demoMode} />
    </div>
  );
}
