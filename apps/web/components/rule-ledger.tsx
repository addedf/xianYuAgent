import Link from "next/link";
import { RULE_PHASES, type RuleRegistryItem } from "@/src/domain/rule-registry";
import { describeRuleConditions, type KnowledgeRuleView } from "@/src/domain/rule-views";

// 生效规则总账的只读展示：按链路阶段分组，人话化取值 + 可折叠原始值/版本历史。
// 这里不放任何操作按钮；维护入口统一指向知识库页的规则操作区。
export function RuleLedger({ registry, rules, demoMode }: { registry: RuleRegistryItem[]; rules: KnowledgeRuleView[]; demoMode: boolean }) {
  const byCode = new Map(rules.map((rule) => [rule.code, rule]));
  return (
    <div className="rule-ledger">
      {RULE_PHASES.map((phase) => {
        const items = registry.filter((item) => item.phase === phase);
        if (items.length === 0) return null;
        const enabledCount = items.filter((item) => item.enabled).length;
        return (
          <section className="rule-ledger-phase" key={phase}>
            <h2 className="rule-ledger-phase-title"><span>{phase}</span><small>{enabledCount}/{items.length} 生效</small></h2>
            {items.map((item) => {
              const rule = byCode.get(item.code);
              return (
                <article className="knowledge-rule-row" key={item.code}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.code} · {item.source} · {item.enabled ? "生效" : "停用"}</small>
                  </div>
                  <p className="rule-registry-value">{item.currentValue}</p>
                  <small>{item.effect}</small>
                  {(item.detail || item.rawValue) && (
                    <details className="rule-ledger-detail">
                      <summary>技术细节与原始值</summary>
                      {item.detail && <p>{item.detail}</p>}
                      {item.rawValue && <p className="rule-registry-value">{item.rawValue}</p>}
                    </details>
                  )}
                  {rule && rule.history.length > 0 && (
                    <details className="rule-version-history">
                      <summary>版本记录（{rule.history.length}）</summary>
                      <ul>
                        {rule.history.map((entry) => (
                          <li key={entry.version}>
                            <strong>v{entry.version}</strong>
                            <span>{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                            <p>{entry.changeReason || "无修改说明"}</p>
                            <p>{entry.sourceType === "ai-assisted" ? "AI 辅助拟定 · 人工保存" : "人工维护"} · {describeRuleConditions(rule.code, entry.conditions)}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {item.editable && !demoMode && <Link className="ledger-edit-link" href="/knowledge#rule-ops">去维护此规则 →</Link>}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
