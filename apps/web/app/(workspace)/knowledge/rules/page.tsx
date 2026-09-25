import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { RuleLedger } from "@/components/rule-ledger";
import { buildRuleRegistry } from "@/src/domain/rule-registry";
import { defaultRuleViews } from "@/src/domain/rule-views";
import { isDemoMode } from "@/src/server/env";
import { loadRuleLedgerData } from "@/src/server/knowledge";
import { JEV_INSTRUCTION, QUESTIONS_VERSION, scoreRubrics } from "@/src/server/evaluators/typesafe/questions";

export const metadata: Metadata = { title: "生效规则总账" };

// 生效规则总账独立页：只读展示评分链路上全部规则，维护操作集中在知识库页的规则操作区。
export default async function RuleLedgerPage() {
  const demoMode = isDemoMode();
  let rules = defaultRuleViews();
  let registry = buildRuleRegistry(rules, 55, 30, QUESTIONS_VERSION, { instruction: JEV_INSTRUCTION, rubrics: scoreRubrics });
  let loadError = false;
  if (!demoMode) {
    try {
      ({ rules, registry } = await loadRuleLedgerData());
    } catch {
      loadError = true;
    }
  }
  const enabledCount = registry.filter((item) => item.enabled).length;
  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header page-header-split">
        <div>
          <p className="context-line"><Link className="breadcrumb-link" href="/knowledge"><ArrowLeft size={12} aria-hidden="true" /> 返回经验知识库</Link></p>
          <h1>生效规则总账</h1>
          <p>评分链路上全部规则的只读视图：前置过滤、事实提取、JEV 上下文与收敛动作。取值为人话化摘要，原始配置和版本记录可折叠核对；维护操作集中在知识库页。</p>
        </div>
        <div className="knowledge-stats" aria-label="规则总账摘要">
          <div><strong>{enabledCount}</strong><span>生效项</span></div>
          <div><strong>{registry.length - enabledCount}</strong><span>停用项</span></div>
          <div><strong>{rules.filter((rule) => rule.enabled).length}/{rules.length}</strong><span>数据库规则</span></div>
        </div>
      </header>
      {loadError && <div className="error-state" role="alert">无法读取 PostgreSQL 规则，请先检查数据库连接。</div>}
      <RuleLedger registry={registry} rules={rules} demoMode={demoMode} />
      <section className="knowledge-governance">
        <ArrowLeft size={22} weight="fill" aria-hidden="true" />
        <div>
          <h3>展示与操作分离</h3>
          <p>本页只做查看与追溯，不直接修改规则。调整阈值、词表或启用状态请返回知识库页的「规则维护操作」区，所有改动都会记录为可追溯版本。</p>
        </div>
      </section>
    </div>
  );
}
