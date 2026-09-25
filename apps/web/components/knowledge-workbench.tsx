"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpenText, Check, FunnelSimple, Plus, ShieldCheck } from "@phosphor-icons/react";
import { ConfidenceChip } from "@/components/status-chip";
import type { KnowledgeEntry } from "@/src/domain/listing";
import { PIPELINE_RULE_CODES, defaultRuleViews, type KnowledgeRuleView } from "@/src/domain/rule-views";
import type { SellerRuleThresholds } from "@/src/domain/seller-rules";
import type { KnowledgeCandidateView, KnowledgeVersionView } from "@/src/server/knowledge";

const typeLabels: Record<KnowledgeEntry["entryType"], string> = {
  identification: "鉴别点",
  "seller-signal": "卖家信号",
  pricing: "价格经验",
  question: "沟通追问",
  case: "案例",
};
const categoryLabels = { watch: "腕表", bag: "箱包", jewelry: "饰品", other: "其他" };
const sellerRuleCode = "seller-non-personal-thresholds";

export function KnowledgeWorkbench({
  initialEntries,
  initialHistory,
  initialRules,
  initialCandidates,
  initialThresholds,
  demoMode,
}: {
  initialEntries: KnowledgeEntry[];
  initialHistory: Record<string, KnowledgeVersionView[]>;
  initialRules: KnowledgeRuleView[];
  initialCandidates: KnowledgeCandidateView[];
  initialThresholds: SellerRuleThresholds;
  demoMode: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [rules, setRules] = useState(initialRules.length > 0 ? initialRules : defaultRuleViews());
  const [candidates, setCandidates] = useState(initialCandidates);
  const [filter, setFilter] = useState<"all" | KnowledgeEntry["entryType"]>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(initialEntries[0]?.id ?? "");
  const [formEntry, setFormEntry] = useState<KnowledgeEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(initialThresholds);
  const [ruleReason, setRuleReason] = useState("");
  const [pipelineReason, setPipelineReason] = useState("");
  const [pipelineSourceType, setPipelineSourceType] = useState<"manual" | "ai-assisted">("manual");
  const [approvalReason, setApprovalReason] = useState("");
  const [opsOpen, setOpsOpen] = useState(false);
  const [counterfeitDraft, setCounterfeitDraft] = useState(() => {
    const rule = initialRules.find((item) => item.code === "listing-counterfeit-terms");
    const terms = (rule?.conditions as { terms?: string[] } | undefined)?.terms;
    return Array.isArray(terms) ? terms.join("、") : "";
  });
  const [priceRatioDraft, setPriceRatioDraft] = useState(() => {
    const rule = initialRules.find((item) => item.code === "listing-extreme-price-gap");
    return Number((rule?.conditions as { priceRatioBelow?: number } | undefined)?.priceRatioBelow ?? 0.18);
  });
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // 从总账页「去维护」跳转过来时自动展开操作区。
    if (window.location.hash === "#rule-ops") setOpsOpen(true);
  }, []);

  const filtered = useMemo(
    () => entries.filter((entry) => (showArchived ? entry.active === false : entry.active !== false) && (filter === "all" || entry.entryType === filter)),
    [entries, filter, showArchived],
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? filtered[0];
  const sellerRule = rules.find((rule) => rule.code === sellerRuleCode) ?? defaultRuleViews()[0];

  async function saveKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demoMode) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      entryType: String(form.get("entryType")) as KnowledgeEntry["entryType"],
      category: String(form.get("category")) as KnowledgeEntry["category"],
      brand: String(form.get("brand") ?? "").trim() || undefined,
      model: String(form.get("model") ?? "").trim() || undefined,
      title: String(form.get("title") ?? "").trim(),
      summary: String(form.get("summary") ?? "").trim(),
      effectChannel: String(form.get("effectChannel")) as KnowledgeEntry["effectChannel"],
      changeReason: String(form.get("changeReason") ?? "").trim(),
    };
    if (!payload.title || !payload.summary || !payload.changeReason) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(formEntry ? "/api/knowledge" : "/api/knowledge", {
        method: formEntry ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formEntry ? { ...payload, id: formEntry.id, confidence: String(form.get("confidence")) } : { ...payload, sourceType: String(form.get("sourceType")) }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; entry?: KnowledgeEntry };
      if (!response.ok || !result.entry) throw new Error(result.error ?? "知识保存失败。");
      if (formEntry) {
        setEntries((current) => current.map((entry) => entry.id === result.entry!.id ? result.entry! : entry));
        setSavedMessage("知识已更新为待复核版本；人工批准后才进入评分。");
      } else {
        setEntries((current) => [result.entry!, ...current]);
        setSelectedId(result.entry.id);
        setFilter("all");
        setSavedMessage("知识草稿已保存到 PostgreSQL；人工批准后才进入评分。");
      }
      setShowForm(false);
      setFormEntry(null);
      router.refresh();
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
      setRuleDraft(result.thresholds);
      setRules((current) => current.map((rule) => rule.code === sellerRuleCode
        ? { ...rule, version: result.version!, conditions: result.thresholds!, changeReason: ruleReason.trim(), enabled: true }
        : rule));
      setRuleReason("");
      setSavedMessage(`卖家判定规则已保存为 v${result.version}。再次评分时会使用新阈值。`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "规则保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function savePipelineRule(code: "listing-counterfeit-terms" | "listing-extreme-price-gap") {
    if (busy || demoMode) return;
    if (!pipelineReason.trim()) { setErrorMessage("请填写规则调整原因。"); return; }
    const terms = counterfeitDraft.split(/[、,，\n]/).map((value) => value.trim()).filter(Boolean);
    const payload = code === "listing-counterfeit-terms"
      ? { code, terms, changeReason: pipelineReason.trim(), sourceType: pipelineSourceType }
      : { code, priceRatioBelow: priceRatioDraft, changeReason: pipelineReason.trim(), sourceType: pipelineSourceType };
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge/pipeline-rule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; rule?: { code: string; version: number; conditions: unknown; enabled: boolean; changeReason: string } };
      if (!response.ok || !result.rule) throw new Error(result.error ?? "规则保存失败。");
      const saved = result.rule;
      setRules((current) => current.map((rule) => rule.code === code ? { ...rule, ...saved } : rule));
      setPipelineReason("");
      setSavedMessage(`${code === "listing-counterfeit-terms" ? "高仿词" : "价格比例"}规则已保存为 v${saved.version}${saved.enabled ? "" : "，仍处于停用状态"}。`);
      router.refresh();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "规则保存失败。"); }
    finally { setBusy(false); }
  }

  async function togglePipelineRule(code: string, enabled: boolean) {
    if (busy || demoMode) return;
    if (!pipelineReason.trim()) { setErrorMessage("启用或停用规则也需要填写调整原因。"); return; }
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge/pipeline-rule", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, enabled, changeReason: pipelineReason.trim() }) });
      const result = await response.json() as { error?: string; rule?: { code: string; version: number; conditions: unknown; enabled: boolean; changeReason: string } };
      if (!response.ok || !result.rule) throw new Error(result.error ?? "规则状态更新失败。");
      const saved = result.rule;
      setRules((current) => current.map((rule) => rule.code === code ? { ...rule, ...saved } : rule));
      setPipelineReason("");
      setSavedMessage(`${enabled ? "已启用" : "已停用"}规则 ${code}，保留版本记录。`);
      router.refresh();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "规则状态更新失败。"); }
    finally { setBusy(false); }
  }

  async function approveEntry(entry: KnowledgeEntry) {
    if (busy || demoMode) return;
    if (!approvalReason.trim()) { setErrorMessage("请填写本次人工复核依据。"); return; }
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/knowledge", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id, approve: true, changeReason: approvalReason.trim() }) });
      const result = await response.json() as { error?: string; entry?: KnowledgeEntry };
      if (!response.ok || !result.entry) throw new Error(result.error ?? "知识批准失败。");
      setEntries((current) => current.map((item) => item.id === entry.id ? result.entry! : item));
      setApprovalReason("");
      setSavedMessage("知识已由人工批准；后续匹配线索会使用当前版本。");
      router.refresh();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "知识批准失败。"); }
    finally { setBusy(false); }
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
      router.refresh();
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
      const result = await response.json().catch(() => ({})) as { error?: string; entry?: KnowledgeEntry };
      if (!response.ok || !result.entry) throw new Error(result.error ?? "知识归档失败。");
      setEntries((current) => current.map((item) => item.id === entry.id ? result.entry! : item));
      if (!active) setSelectedId(entries.find((item) => item.id !== entry.id && item.active !== false)?.id ?? "");
      setSavedMessage(active ? "知识已恢复，并保留了版本记录。" : "知识已归档，版本记录仍保留在数据库中。");
      router.refresh();
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
            <div><h2>规则维护</h2><p>调整卖家阈值、高仿词表、价格比例与规则启停，全部改动记录为可追溯版本。</p></div>
            <span>v{sellerRule.version}</span>
          </header>
          <div className="rule-ledger-link-row">
            <Link className="button button-secondary button-small" href="/knowledge/rules">查看生效规则总账 →</Link>
          </div>
          <details className="rule-ops" id="rule-ops" open={opsOpen} onToggle={(event) => setOpsOpen((event.target as HTMLDetailsElement).open)}>
            <summary>规则维护操作<small>卖家阈值 · 高仿词 · 价格比例 · 启用/停用</small></summary>
          <form className="seller-rule-form" onSubmit={saveSellerRule}>
            <label>同品类已采集商品数达到
              <span className="seller-rule-number"><input type="number" min={1} max={10_000} value={ruleDraft.sameCategoryMinCount} onChange={(event) => setRuleDraft((current) => ({ ...current, sameCategoryMinCount: Number(event.target.value) }))} disabled={demoMode || busy} /><small>条</small></span>
            </label>
          <label>主页在售数量达到
              <span className="seller-rule-number"><input type="number" min={1} max={1_000_000} value={ruleDraft.onSaleMinCount} onChange={(event) => setRuleDraft((current) => ({ ...current, onSaleMinCount: Number(event.target.value) }))} disabled={demoMode || busy} /><small>件</small></span>
            </label>
          <label>已核实售出数超过
              <span className="seller-rule-number"><input type="number" min={0} max={10_000_000} value={ruleDraft.completedSaleMinCount} onChange={(event) => setRuleDraft((current) => ({ ...current, completedSaleMinCount: Number(event.target.value) }))} disabled={demoMode || busy} /><small>件</small></span>
            </label>
            <label className="seller-rule-reason">调整原因
              <input value={ruleReason} onChange={(event) => setRuleReason(event.target.value)} placeholder="例如：同商家集中发布同类商品，降低个人卖家概率" maxLength={500} disabled={demoMode || busy} />
            </label>
            <button className="button button-primary button-small" type="submit" disabled={demoMode || busy}>{busy ? "保存中…" : "保存新版本"}</button>
          </form>
          <div className="pipeline-rule-editor">
            <label>高仿词表（用顿号、逗号或换行分隔）
              <textarea value={counterfeitDraft} onChange={(event) => setCounterfeitDraft(event.target.value)} rows={3} disabled={demoMode || busy} />
            </label>
            <label>价格过滤比例
              <span className="seller-rule-number"><input type="number" min="0.01" max="0.99" step="0.01" value={priceRatioDraft} onChange={(event) => setPriceRatioDraft(Number(event.target.value))} disabled={demoMode || busy} /><small>挂牌价 / 参考价</small></span>
            </label>
            <label>调整原因<input value={pipelineReason} onChange={(event) => setPipelineReason(event.target.value)} maxLength={500} placeholder="保存或切换规则状态时必填" disabled={demoMode || busy} /></label>
            <label>规则内容来源<select value={pipelineSourceType} onChange={(event) => setPipelineSourceType(event.target.value as "manual" | "ai-assisted")} disabled={demoMode || busy}><option value="manual">人工拟定</option><option value="ai-assisted">AI 辅助拟定，由我确认保存</option></select></label>
            <div className="form-actions">
              <button className="button button-secondary button-small" type="button" disabled={demoMode || busy} onClick={() => void savePipelineRule("listing-counterfeit-terms")}>保存高仿词新版本</button>
              <button className="button button-secondary button-small" type="button" disabled={demoMode || busy} onClick={() => void savePipelineRule("listing-extreme-price-gap")}>保存价格比例新版本</button>
            </div>
          </div>
            <div className="rule-ops-state">
              <p className="rule-ops-state-hint">数据库前置规则启停（需先填写上方调整原因）：</p>
              {rules.filter((rule) => PIPELINE_RULE_CODES.includes(rule.code)).map((rule) => (
                <span className="rule-ops-state-item" key={rule.code}>
                  <strong>{rule.title}</strong>
                  <small>v{rule.version} · {rule.enabled ? "生效中" : "已停用"}</small>
                  <button className="button button-ghost button-small" type="button" disabled={demoMode || busy} onClick={() => void togglePipelineRule(rule.code, !rule.enabled)}>{rule.enabled ? "停用" : "启用"}</button>
                </span>
              ))}
            </div>
          </details>
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
                  <option value="watch">腕表</option><option value="bag">箱包</option><option value="jewelry">饰品</option><option value="other">其他</option>
                </select></label>
              </div>
              <label>品牌范围<input name="brand" defaultValue={formEntry?.brand ?? ""} maxLength={80} placeholder="留空表示通用品类经验" /></label>
              <label>型号或款式范围<input name="model" defaultValue={formEntry?.model ?? ""} maxLength={120} placeholder="留空表示该品牌下通用" /></label>
              <label>标题<input name="title" required maxLength={80} defaultValue={formEntry?.title ?? ""} placeholder="例如：日志型表扣补拍要求" /></label>
              <label>经验说明<textarea name="summary" required maxLength={4000} rows={4} defaultValue={formEntry?.summary ?? ""} placeholder="写清适用范围、判断依据和不能推出的结论。" /></label>
              <label>生效通道<select name="effectChannel" defaultValue={formEntry?.effectChannel ?? "jev-context"}><option value="jev-context">人工批准后进入 JEV 上下文</option><option value="manual-only">仅供人工查阅</option></select></label>
              {!formEntry && <label>来源<select name="sourceType" defaultValue="manual"><option value="manual">人工录入</option><option value="ai-assisted">AI 辅助补充（先存草稿）</option></select></label>}
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
                  <small>{typeLabels[entry.entryType]} · {entry.brand ?? categoryLabels[entry.category]}{entry.model ? ` · ${entry.model}` : ""} · v{entry.version} · {entry.active === false ? "已归档" : entry.reviewStatus === "approved" ? entry.effectChannel === "jev-context" ? "评分生效中" : "人工查阅" : "待人工复核"}{entry.sourceType === "ai-assisted" ? " · AI 辅助" : ""}</small>
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
            {selected.reviewStatus !== "approved" && selected.active !== false && <div className="knowledge-approval">
              <p>这条知识目前是草稿，不参与评分。核对内容、来源和适用范围后批准。</p>
              <label>复核依据<input value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} placeholder="例如：已核对同型号案例和适用范围" disabled={demoMode || busy} /></label>
              <button className="button button-primary button-small" type="button" disabled={demoMode || busy} onClick={() => void approveEntry(selected)}>人工批准当前版本</button>
            </div>}
            <div className="knowledge-meta">
              <div><span>适用品类</span><strong>{categoryLabels[selected.category]}</strong></div>
              <div><span>品牌范围</span><strong>{selected.brand ?? "通用品类规则"}</strong></div>
              <div><span>型号范围</span><strong>{selected.model ?? "通用"}</strong></div>
              <div><span>当前版本</span><strong>v{selected.version}</strong></div>
              <div><span>当前评估引用</span><strong>{selected.usageCount} 条</strong></div>
              <div><span>生效通道</span><strong>{selected.effectChannel === "jev-context" ? "JEV 上下文" : "人工查阅"}</strong></div>
              <div><span>复核状态</span><strong>{selected.reviewStatus === "approved" ? "已批准" : "待复核"}</strong></div>
            </div>
            <section className="knowledge-content"><h3>当前标准</h3><p>{selected.summary}</p></section>
            <section className="knowledge-governance"><ShieldCheck size={22} weight="fill" aria-hidden="true" /><div><h3>修改会保留历史版本</h3><p>条目经人工批准后可进入 JEV 参考上下文；结构化过滤规则独立控制是否拦截。AI 补充内容先进入待复核列表。</p></div></section>
            <section className="version-timeline"><h3>版本与来源</h3><ol>
              {(initialHistory[selected.id] ?? []).map((version) => <li key={version.version}>
                <span>v{version.version}</span>
                <div><strong>{version.sourceType === "ai-assisted" ? "AI 辅助补充" : "人工维护"}{version.approvedBy ? " · 已批准" : " · 待复核"}</strong>
                  <p>{new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })} · {version.changeReason}</p>
                  <p>{typeof version.content.summary === "string" ? version.content.summary : "该版本记录状态或范围变更"}</p>
                </div>
              </li>)}
              {!initialHistory[selected.id]?.length && <li><span>v{selected.version}</span><div><strong>{selected.sourceLabel}</strong><p>演示或存量记录</p></div></li>}
            </ol></section>
          </> : <div className="empty-state">选择一条知识查看范围、版本与来源。</div>}
        </section>
      </div>
    </>
  );
}
