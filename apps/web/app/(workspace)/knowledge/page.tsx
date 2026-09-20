import type { Metadata } from "next";
import { ArrowRight, CheckCircle, GitBranch, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { KnowledgeWorkbench } from "@/components/knowledge-workbench";
import { demoKnowledgeEntries } from "@/src/data/demo";
import { isDemoMode } from "@/src/server/env";

export const metadata: Metadata = { title: "经验知识库" };

export default function KnowledgePage() {
  const demoMode = isDemoMode();
  const entries = demoMode ? demoKnowledgeEntries : [];
  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header page-header-split">
        <div>
          <p className="context-line">结构化经验 · 人工批准 · 版本可回滚</p>
          <h1>经验知识库</h1>
          <p>把商品判断和成交反馈沉淀为可维护的鉴别点、卖家信号、价格经验、追问策略与案例。</p>
        </div>
        <div className="knowledge-stats" aria-label="知识库摘要">
          <div><strong>{entries.length}</strong><span>当前条目</span></div>
          <div><strong>{demoMode ? 3 : 0}</strong><span>待复核候选</span></div>
          <div><strong>{demoMode ? 2 : 0}</strong><span>已验证规则</span></div>
        </div>
      </header>

      <section className="learning-flow" aria-label="经验沉淀流程">
        <div><Sparkle size={20} weight="fill" /><span><strong>发现差异</strong><small>原判断与最终结果不一致</small></span></div>
        <ArrowRight size={17} className="flow-arrow" aria-hidden="true" />
        <div><GitBranch size={20} weight="fill" /><span><strong>生成候选</strong><small>保留商品、证据与纠正原因</small></span></div>
        <ArrowRight size={17} className="flow-arrow" aria-hidden="true" />
        <div><CheckCircle size={20} weight="fill" /><span><strong>人工批准</strong><small>发布新版本并保留旧规则</small></span></div>
      </section>

      <KnowledgeWorkbench initialEntries={entries} />
    </div>
  );
}
