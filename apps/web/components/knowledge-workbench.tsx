"use client";

import { FormEvent, useMemo, useState } from "react";
import { BookOpenText, Check, FunnelSimple, Plus, ShieldCheck } from "@phosphor-icons/react";
import { ConfidenceChip } from "@/components/status-chip";
import type { KnowledgeEntry } from "@/src/domain/listing";
import type { SellerRuleThresholds } from "@/src/domain/seller-rules";
import type { KnowledgeCandidateView, KnowledgeRuleView } from "@/src/server/knowledge";

const typeLabels: Record<KnowledgeEntry["entryType"], string> = {
  identification: "鉴别点",
  "seller-signal": "卖家信号",
  pricing: "价格经验",
  question: "沟通追问",
  case: "案例",
};
const categoryLabels = { watch: "腕表", bag: "箱包", jewelry: "饰品" };
const sellerRuleCode = "seller-non-personal-thresholds";
const defaultSellerRule: KnowledgeRuleView = {
  id: "seller-rule-default",
  code: sellerRuleCode,
  title: "疑似非个人卖家判定阈值",
  category: "seller",
  enabled: true,
  version: 1,
  conditions: { sameCategoryMinCount: 6, completedSaleMinCount: 100 },
  scoreImpact: -20,
  explanation: "同品类已采集商品数达到阈值，或已核实售出数超过阈值时，标记为疑似非个人卖家并降低个人卖家概率。",
  changeReason: "系统默认阈值；保存后会记录为可追溯版本。",
};

export function KnowledgeWorkbench({
  initialEntries,
  initialRules,
  initialCandidates,
  initialThresholds,
  demoMode,
}: {
  initialEntries: KnowledgeEntry[];
  initialRules: KnowledgeRuleView[];
  initialCandidates: KnowledgeCandidateView[];
  initialThresholds: SellerRuleThresholds;
  demoMode: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [rules, setRules] = useState(initialRules.length > 0 ? initialRules : [defaultSellerRule]);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [thresholds, setThresholds] = useState(initialThresholds);
  const [filter, setFilter] = useState<"all" | KnowledgeEntry["entryType"]>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(initialEntries[0]?.id ?? "");
  const [formEntry, setFormEntry] = useState<KnowledgeEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(initialThresholds);
  const [ruleReason, setRuleReason] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filtered = useMemo(
    () => entries.filter((entry) => (showArchived ? entry.active === false : entry.active !== false) && (filter === "all" || entry.entryType === filter)),
    [entries, filter, showArchived],
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? filtered[0];
  const sellerRule = rules.find((rule) => rule.code === sellerRuleCode) ?? defaultSellerRule;

  async function saveKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demoMode) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      entryType: String(form.get("entryType")) as KnowledgeEntry["entryType"],
      category: String(form.get("category")) as KnowledgeEntry["category"],
      brand: String(form.get("brand") ?? "").trim() || undefined,
      title: String(form.get("title") ?? "").trim(),
      summary: String(form.get("summary") ?? "").trim(),
      changeReason: String(form.get("changeReason") ?? "").trim(),
    };
    if (!payload.title || !payload.summary || !payload.changeReason) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(formEntry ? "/api/knowledge" : "/api/knowledge", {
        method: formEntry ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formEntry ? { ...payload, id: formEntry.id, confidence: String(form.get("confidence")) } : payload),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; entry?: KnowledgeEntry };
      if (!response.ok || !result.entry) throw new Error(result.error ?? "知识保存失败。");
      if (formEntry) {
        setEntries((current) => current.map((entry) => entry.id === result.entry!.id ? result.entry! : entry));
        setSavedMessage("知识已更新，并保留了版本记录。");
      } else {
        setEntries((current) => [result.entry!, ...current]);
        setSelectedId(result.entry.id);
        setFilter("all");
        setSavedMessage("知识草稿已保存到 PostgreSQL。");
      }
      setShowForm(false);
      setFormEntry(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "知识保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveSellerRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demoMode) return;
    if (!ruleReason.trim()) {
      setErrorMessage("请填写本次规则调整原因。");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge/seller-rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...ruleDraft, changeReason: ruleReason.trim() }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; version?: number; thresholds?: SellerRuleThresholds };
      if (!response.ok || !result.thresholds || !result.version) throw new Error(result.error ?? "规则保存失败。");
      setThresholds(result.thresholds);
      setRuleDraft(result.thresholds);
      setRules((current) => current.map((rule) => rule.code === sellerRuleCode
        ? { ...rule, version: result.version!, conditions: result.thresholds!, changeReason: ruleReason.trim(), enabled: true }
        : rule));
      setRuleReason("");
      setSavedMessage(`卖家判定规则已保存为 v${result.version}。再次评分时会使用新阈值。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "规则保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function addCandidateToKnowledge(candidate: KnowledgeCandidateView) {
    if (busy || demoMode) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedbackId: candidate.id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; entryId?: string };
      if (!response.ok || !result.entryId) throw new Error(result.error ?? "候选转存失败。");
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
      setSavedMessage("候选已转为知识草稿，在知识列表中可以继续编辑和维护。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "候选转存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function setEntryActive(entry: KnowledgeEntry, active: boolean) {
    if (busy || demoMode) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: entry.id, active, changeReason: active ? "人工恢复知识条目" : "人工归档知识条目" }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "知识归档失败。");
      setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, active, version: item.version + 1, updatedAt: new Date().toISOString() } : item));
      if (!active) setSelectedId(entries.find((item) => item.id !== entry.id && item.active !== false)?.id ?? "");
      setSavedMessage(active ? "知识已恢复，并保留了版本记录。" : "知识已归档，版本记录仍保留在数据库中。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "知识归档失败。");
    } finally {
      setBusy(false);
    }
  }

  function openCreateForm() {
    setFormEntry(null);
    setShowForm(true);
    setSavedMessage(null);
    setErrorMessage(null);
  }

  function openEditForm(entry: KnowledgeEntry) {
    setFormEntry(entry);
    setShowForm(true);
    setSavedMessage(null);
    setErrorMessage(null);
  }

  return (
    <>
      {(savedMessage || errorMessage) && <div className={errorMessage ? "error-state" : "inline-notice"} role={errorMessage ? "alert" : "status"}>{errorMessage ?? savedMessage}</div>}

      <div className="knowledge-admin-panels">
        <section className="knowledge-rule-panel">
          <header className="knowledge-panel-heading">
            <div><h2>当前执行规则</h2><p>这条规则会进入规则评分与 JEV 上下文，保存后再触发重新评分生效。</p></div>
            <span>v{sellerRule.version}</span>
          </header>
          <form className="seller-rule-form" onSubmit={saveSellerRule}>
            <label>同品类已采集商品数达到
              <span className="seller-rule-number"><input type="number" min={1} max={10_000} value={ruleDraft.sameCategoryMinCount} onChange={(event) => setRuleDraft((current) => ({ ...current, sameCategoryMinCount: Number(event.target.value) }))} disabled={demoMode || busy} /><small>条</small></span>
            </label>
          <label>已核实售出数超过
              <span className="seller-rule-number"><input type="number" min={0} max={10_000_000} value={ruleDraft.completedSaleMinCount} onChange={(event) => setRuleDraft((current) => ({ ...current, completedSaleMinCount: Number(event.target.value) }))} disabled={demoMode || busy} /><small>件</small></span>
            </label>
            <label className="seller-rule-reason">调整原因
              <input value={ruleReason} onChange={(event) => setRuleReason(event.target.value)} placeholder="例如：同商家集中发布同类商品，降低个人卖家概率" maxLength={500} disabled={demoMode || busy} />
            </label>
            <button className="button button-primary button-small" type="submit" disabled={demoMode || busy}>{busy ? "保存中…" : "保存新版本"}</button>
          </form>
          <div className="knowledge-rule-list" aria-label="数据库中的规则">
            {rules.map((rule) => (
              <article className="knowledge-rule-row" key={rule.id}>
                <div><strong>{rule.title}</strong><small>{rule.code} · v{rule.version} · {rule.enabled ? "启用" : "停用"}</small></div>
                <p>{rule.code === sellerRuleCode
                  ? `同品类 ${thresholds.sameCategoryMinCount} 条或已核实售出超过 ${thresholds.completedSaleMinCount} 件，标记疑似非个人卖家。`
                  : rule.explanation || JSON.stringify(rule.conditions)}</p>
                {rule.code !== sellerRuleCode && <code>{JSON.stringify(rule.conditions)}</code>}
                <small>调整记录：{rule.changeReason || "尚无修改说明"}</small>
              </article>
            ))}
            {rules.length === 0 && <p className="empty-state">还没有已保存的规则。</p>}
          </div>
        </section>

        <section className="knowledge-candidate-panel">
          <header className="knowledge-panel-heading">
            <div><h2>人工规则候选</h2><p>线索页提交的规则意见会出现在这里，可转为可编辑的知识草稿。</p></div>
            <span>{candidates.length} 条</span>
          </header>
          <div className="knowledge-candidate-list">
            {candidates.map((candidate) => (
              <article className="knowledge-candidate-row" key={candidate.id}>
                <div><strong>{candidate.label}</strong><small>{categoryLabels[candidate.category]} · {candidate.title} · {new Date(candidate.createdAt).toLocaleDateString("zh-CN")}</small></div>
                <p>{candidate.text}</p>
                <button className="button button-secondary button-small" type="button" disabled={demoMode || busy} onClick={() => void addCandidateToKnowledge(candidate)}>转为知识草稿</button>
              </article>
            ))}
            {candidates.length === 0 && <p className="empty-state">暂无待复核的规则候选。在线索页选择“规则候选”提交后会显示在这里。</p>}
          </div>
        </section>
      </div>

      <div className="knowledge-workbench">
        <section className="knowledge-list-panel">
          <div className="knowledge-toolbar">
            <div className="toolbar-title"><FunnelSimple size={18} aria-hidden="true" /><span>知识与案例</span></div>
            <div className="knowledge-toolbar-actions">
              <button className="button button-ghost button-small" type="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "查看当前知识" : "查看已归档"}</button>
              <button className="button button-primary button-small" type="button" onClick={openCreateForm} disabled={demoMode || busy}>
                <Plus size={16} weight="bold" aria-hidden="true" />新增知识
              </button>
            </div>
          </div>
          <div className="knowledge-filters" role="group" aria-label="知识类型筛选">
            {(["all", "identification", "seller-signal", "pricing", "question", "case"] as const).map((value) => (
              <button key={value} data-active={filter === value} type="button" onClick={() => setFilter(value)}>
                {value === "all" ? "全部" : typeLabels[value]}
              </button>
            ))}
          </div>

          {showForm && (
            <form className="knowledge-form" key={formEntry?.id ?? "new"} onSubmit={saveKnowledge}>
              <div className="form-row">
                <label>类型<select name="entryType" defaultValue={formEntry?.entryType ?? "identification"}>
                  {Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label>品类<select name="category" defaultValue={formEntry?.category ?? "watch"}>
                  <option value="watch">腕表</option><option value="bag">箱包</option><option value="jewelry">饰品</option>
                </select></label>
              </div>
              <label>品牌范围<input name="brand" defaultValue={formEntry?.brand ?? ""} maxLength={80} placeholder="留空表示通用品类经验" /></label>
              <label>标题<input name="title" required maxLength={80} defaultValue={formEntry?.title ?? ""} placeholder="例如：日志型表扣补拍要求" /></label>
              <label>经验说明<textarea name="summary" required maxLength={4000} rows={4} defaultValue={formEntry?.summary ?? ""} placeholder="写清适用范围、判断依据和不能推出的结论。" /></label>
              {formEntry && <label>维护状态<select name="confidence" defaultValue={formEntry.confidence}><option value="draft">草稿</option><option value="reviewed">已复核</option><option value="verified">已验证</option></select></label>}
              <label>修改原因<input name="changeReason" required maxLength={500} placeholder={formEntry ? "本次修改依据" : "新增来源或适用范围"} /></label>
              <div className="form-actions">
                <button className="button button-ghost" type="button" onClick={() => { setShowForm(false); setFormEntry(null); }}>取消</button>
                <button className="button button-primary" type="submit" disabled={busy}><Check size={16} />{busy ? "保存中…" : formEntry ? "保存新版本" : "保存知识草稿"}</button>
              </div>
            </form>
          )}

          <div className="knowledge-entry-list">
            {filtered.map((entry) => (
              <button className="knowledge-entry-row" data-active={selected?.id === entry.id} data-archived={entry.active === false} key={entry.id} onClick={() => setSelectedId(entry.id)} type="button">
                <span className="knowledge-type-mark" aria-hidden="true"><BookOpenText size={18} /></span>
                <span><span className="entry-row-topline"><strong>{entry.title}</strong><ConfidenceChip value={entry.confidence} /></span>
                  <small>{typeLabels[entry.entryType]} · {entry.brand ?? categoryLabels[entry.category]} · v{entry.version}{entry.active === false ? " · 已归档" : ""}</small>
                </span>
              </button>
            ))}
            {filtered.length === 0 && !showForm && <div className="empty-state">还没有知识条目，可从人工规则候选转入或手动新增。</div>}
          </div>
        </section>

        <section className="knowledge-detail-panel">
          {selected ? <>
            <header>
              <div><span className="knowledge-type-label">{typeLabels[selected.entryType]}</span><h2>{selected.title}</h2></div>
              <ConfidenceChip value={selected.confidence} />
            </header>
            <div className="knowledge-detail-actions">
              <button className="button button-secondary button-small" type="button" disabled={demoMode || busy} onClick={() => openEditForm(selected)}>编辑知识</button>
              <button className="button button-ghost button-small" type="button" disabled={demoMode || busy} onClick={() => void setEntryActive(selected, selected.active === false)}>{selected.active === false ? "恢复" : "归档"}</button>
            </div>
            <div className="knowledge-meta">
              <div><span>适用品类</span><strong>{categoryLabels[selected.category]}</strong></div>
              <div><span>品牌范围</span><strong>{selected.brand ?? "通用品类规则"}</strong></div>
              <div><span>当前版本</span><strong>v{selected.version}</strong></div>
              <div><span>规则引用</span><strong>{selected.usageCount} 次</strong></div>
            </div>
            <section className="knowledge-content"><h3>当前标准</h3><p>{selected.summary}</p></section>
            <section className="knowledge-governance"><ShieldCheck size={22} weight="fill" aria-hidden="true" /><div><h3>修改会保留历史版本</h3><p>知识草稿供人工维护和复核；只有结构化执行规则会直接影响评分。规则候选可以先整理成知识，再决定是否调整执行阈值。</p></div></section>
            <section className="version-timeline"><h3>版本与来源</h3><ol>
              <li><span>v{selected.version}</span><div><strong>{selected.sourceLabel}</strong><p>当前版本 · {new Date(selected.updatedAt).toLocaleDateString("zh-CN")}</p></div></li>
              {selected.version > 1 && <li><span>v{selected.version - 1}</span><div><strong>历史版本</strong><p>保留旧内容和修改原因，可在数据库中审计。</p></div></li>}
            </ol></section>
          </> : <div className="empty-state">选择一条知识查看范围、版本与来源。</div>}
        </section>
      </div>
    </>
  );
}
