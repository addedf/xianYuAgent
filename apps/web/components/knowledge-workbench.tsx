"use client";

import { FormEvent, useMemo, useState } from "react";
import { BookOpenText, Check, FunnelSimple, Plus, ShieldCheck } from "@phosphor-icons/react";
import { ConfidenceChip } from "@/components/status-chip";
import type { KnowledgeEntry } from "@/src/domain/listing";

const typeLabels = {
  identification: "鉴别点",
  "seller-signal": "卖家信号",
  pricing: "价格经验",
  question: "沟通追问",
  case: "案例",
};

export function KnowledgeWorkbench({ initialEntries }: { initialEntries: KnowledgeEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [filter, setFilter] = useState<"all" | KnowledgeEntry["entryType"]>("all");
  const [selectedId, setSelectedId] = useState(initialEntries[0]?.id ?? "");
  const [showForm, setShowForm] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const filtered = useMemo(
    () => entries.filter((entry) => filter === "all" || entry.entryType === filter),
    [entries, filter],
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? filtered[0];

  function addDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const entryType = String(form.get("entryType") ?? "case") as KnowledgeEntry["entryType"];
    const category = String(form.get("category") ?? "watch") as KnowledgeEntry["category"];
    if (!title || !summary) return;

    const entry: KnowledgeEntry = {
      id: `draft-${Date.now()}`,
      entryType,
      category,
      title,
      summary,
      confidence: "draft",
      version: 1,
      sourceLabel: "本地手动录入",
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    };
    setEntries((current) => [entry, ...current]);
    setSelectedId(entry.id);
    setFilter("all");
    setShowForm(false);
    setSavedMessage("草稿已加入当前演示会话。连接 PostgreSQL 后将持久化并进入复核队列。");
    event.currentTarget.reset();
  }

  return (
    <div className="knowledge-workbench">
      <section className="knowledge-list-panel">
        <div className="knowledge-toolbar">
          <div className="toolbar-title">
            <FunnelSimple size={18} aria-hidden="true" />
            <span>知识类型</span>
          </div>
          <button className="button button-primary button-small" type="button" onClick={() => setShowForm((value) => !value)}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            新增知识
          </button>
        </div>

        <div className="knowledge-filters" role="group" aria-label="知识类型筛选">
          {(["all", "identification", "seller-signal", "question", "case"] as const).map((value) => (
            <button key={value} data-active={filter === value} type="button" onClick={() => setFilter(value)}>
              {value === "all" ? "全部" : typeLabels[value]}
            </button>
          ))}
        </div>

        {showForm && (
          <form className="knowledge-form" onSubmit={addDraft}>
            <div className="form-row">
              <label>
                类型
                <select name="entryType" defaultValue="identification">
                  {Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label>
                品类
                <select name="category" defaultValue="watch">
                  <option value="watch">腕表</option>
                  <option value="bag">箱包</option>
                  <option value="jewelry">饰品</option>
                </select>
              </label>
            </div>
            <label>
              标题
              <input name="title" required maxLength={80} placeholder="例如：日志型表扣补拍要求" />
            </label>
            <label>
              经验说明
              <textarea name="summary" required maxLength={500} rows={4} placeholder="写清适用范围、判断依据和不能推出的结论。" />
            </label>
            <div className="form-actions">
              <button className="button button-ghost" type="button" onClick={() => setShowForm(false)}>取消</button>
              <button className="button button-primary" type="submit"><Check size={16} />保存草稿</button>
            </div>
          </form>
        )}

        {savedMessage && <div className="inline-notice" role="status">{savedMessage}</div>}

        <div className="knowledge-entry-list">
          {filtered.map((entry) => (
            <button
              className="knowledge-entry-row"
              data-active={selected?.id === entry.id}
              key={entry.id}
              onClick={() => setSelectedId(entry.id)}
              type="button"
            >
              <span className="knowledge-type-mark" aria-hidden="true"><BookOpenText size={18} /></span>
              <span>
                <span className="entry-row-topline">
                  <strong>{entry.title}</strong>
                  <ConfidenceChip value={entry.confidence} />
                </span>
                <small>{typeLabels[entry.entryType]} · {entry.brand ?? (entry.category === "watch" ? "腕表" : entry.category === "bag" ? "箱包" : "饰品")}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="knowledge-detail-panel">
        {selected ? (
          <>
            <header>
              <div>
                <span className="knowledge-type-label">{typeLabels[selected.entryType]}</span>
                <h2>{selected.title}</h2>
              </div>
              <ConfidenceChip value={selected.confidence} />
            </header>

            <div className="knowledge-meta">
              <div><span>适用品类</span><strong>{selected.category === "watch" ? "腕表" : selected.category === "bag" ? "箱包" : "饰品"}</strong></div>
              <div><span>品牌范围</span><strong>{selected.brand ?? "通用品类规则"}</strong></div>
              <div><span>当前版本</span><strong>v{selected.version}</strong></div>
              <div><span>规则引用</span><strong>{selected.usageCount} 次</strong></div>
            </div>

            <section className="knowledge-content">
              <h3>当前标准</h3>
              <p>{selected.summary}</p>
            </section>

            <section className="knowledge-governance">
              <ShieldCheck size={22} weight="fill" aria-hidden="true" />
              <div>
                <h3>经验不会自动升级为规则</h3>
                <p>Agent 只能提出候选。必须记录来源、适用范围、反例与修改原因，经人工复核后创建新版本；旧版本保留用于审计和回滚。</p>
              </div>
            </section>

            <section className="version-timeline">
              <h3>版本与来源</h3>
              <ol>
                <li><span>v{selected.version}</span><div><strong>{selected.sourceLabel}</strong><p>当前生效版本 · {new Date(selected.updatedAt).toLocaleDateString("zh-CN")}</p></div></li>
                {selected.version > 1 && <li><span>v{selected.version - 1}</span><div><strong>历史版本</strong><p>保留原始判断标准，可对比与回滚。</p></div></li>}
              </ol>
            </section>
          </>
        ) : (
          <div className="empty-state">选择一条知识查看范围、版本与来源。</div>
        )}
      </section>
    </div>
  );
}

