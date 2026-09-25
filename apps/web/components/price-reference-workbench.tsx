"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { PriceReferenceListingView, PriceReferenceView } from "@/src/server/knowledge";

const priceTypeLabels: Record<string, string> = { actual_sale: "已核实成交", asking: "挂牌价", buyback_quote: "回收报价", estimated_resale: "估计转售价", retail_msrp: "新品公价" };
const categoryLabels: Record<string, string> = { watch: "腕表", bag: "箱包", jewelry: "饰品", other: "其他" };
const gradeLabels: Record<string, string> = { new: "全新未使用", near_new: "近新", good: "良好", fair: "一般", unknown: "成色未核实" };

function statusLabel(item: PriceReferenceView): string {
  return item.applied ? "过滤生效" : item.superseded ? "历史版本" : item.status === "approved" ? "已批准，仅参考" : item.status === "pending" ? "待人工复核" : "已停用";
}

// 展示与操作分离：默认一行一款，备注/样本/审批操作折叠进详情；录入表单默认收起。
export function PriceReferenceWorkbench({ listings, references, demoMode }: { listings: PriceReferenceListingView[]; references: PriceReferenceView[]; demoMode: boolean }) {
  const [listingId, setListingId] = useState("");
  const [category, setCategory] = useState("watch");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedListing = listings.find((item) => item.id === listingId);

  const sortedReferences = useMemo(() => {
    const rank = (item: PriceReferenceView) => (item.status === "pending" && !item.superseded ? 0 : item.superseded ? 2 : 1);
    return [...references].sort((a, b) => rank(a) - rank(b));
  }, [references]);
  const pendingCount = references.filter((item) => item.status === "pending" && !item.superseded).length;

  function chooseListing(id: string) {
    setListingId(id);
    const listing = listings.find((item) => item.id === id);
    if (listing) { setCategory(listing.category); setBrand(listing.brand); setModel(listing.model ?? ""); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demoMode || busy) return;
    const form = new FormData(event.currentTarget);
    const observedAt = new Date(String(form.get("observedAt")));
    if (Number.isNaN(observedAt.getTime())) { setError("请输入有效的价格观察时间。"); return; }
    const sampleLines = String(form.get("sampleEvidence") ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sampleEvidence = sampleLines.map((line) => {
      const [sourceLabel, amountText, observedAtText, ...rest] = line.split("|").map((part) => part.trim());
      return { sourceLabel, amount: Number(amountText), observedAt: observedAtText, valid: rest.length === 0 && Boolean(sourceLabel) && Number(amountText) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(observedAtText ?? "") };
    });
    if (sampleEvidence.length === 0 || sampleEvidence.length > 50 || sampleEvidence.some((item) => !item.valid)) { setError("请逐行填写样本：来源或匿名成交编号 | 金额 | YYYY-MM-DD；最多 50 条。"); return; }
    const payload = {
      listingId: listingId || null, category, brand: brand.trim(), model: model.trim(),
      amount: Number(form.get("amount")), currency: String(form.get("currency") ?? "CNY").trim().toUpperCase(),
      priceType: String(form.get("priceType")), conditionNote: String(form.get("conditionNote") ?? "").trim(),
      conditionGrade: String(form.get("conditionGrade")),
      productionYear: String(form.get("productionYear") ?? "").trim() ? Number(form.get("productionYear")) : null,
      accessories: String(form.get("accessories") ?? "").split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
      market: String(form.get("market")), marketRegion: String(form.get("marketRegion") ?? "").trim(),
      sourceLabel: String(form.get("sourceLabel") ?? "").trim(), sourceUrl: String(form.get("sourceUrl") ?? "").trim() || undefined,
      sampleEvidence: sampleEvidence.map(({ sourceLabel, amount, observedAt }) => ({ sourceLabel, amount, observedAt })), observedAt: observedAt.toISOString(),
      changeReason: String(form.get("changeReason") ?? "").trim(), origin: String(form.get("origin")),
    };
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/knowledge/price-reference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "参考价保存失败。");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参考价保存失败。"); }
    finally { setBusy(false); }
  }

  async function review(id: string, action: "approve" | "disable") {
    if (demoMode || busy) return;
    const changeReason = window.prompt(action === "approve" ? "请输入人工复核依据" : "请输入停用原因")?.trim();
    if (!changeReason) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/knowledge/price-reference", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, changeReason }) });
      const result = await response.json() as { error?: string; applied?: boolean };
      if (!response.ok) throw new Error(result.error ?? "参考价状态更新失败。");
      setMessage(action === "approve" ? result.applied ? "参考价已批准并用于关联线索。" : "参考价已批准供人工查阅；尚不满足自动过滤条件。" : "参考价已停用。");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参考价状态更新失败。"); }
    finally { setBusy(false); }
  }

  return <section className="knowledge-rule-panel price-reference-workbench" aria-labelledby="price-reference-heading">
    <header className="knowledge-panel-heading"><div><h2 id="price-reference-heading">市场参考价数据</h2><p>一行一款型号参考价；详情内含口径说明、逐条样本与审批操作。只有关联线索且满足条件的已批准成交参考价才进入 18% 过滤。</p></div><span>{pendingCount > 0 ? `${pendingCount} 待复核` : `${references.length} 条`}</span></header>
    {(message || error) && <p className={error ? "error-state" : "inline-notice"} role={error ? "alert" : "status"}>{error || message}</p>}
    <details className="price-reference-form-panel">
      <summary>录入 / 更新参考价<small>型号资料或关联线索 · AI 补充先存待复核</small></summary>
      <form className="price-reference-form" onSubmit={save}>
        <label>关联线索（可先留空建型号资料）<select value={listingId} onChange={(event) => chooseListing(event.target.value)} disabled={demoMode || busy}>
          <option value="">暂不关联线索</option>
          {listings.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.brand} · ¥{item.price}</option>)}
        </select></label>
        <div className="form-row"><label>品类<select value={category} onChange={(event) => setCategory(event.target.value)} disabled={demoMode || busy}>
          {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label><label>品牌<input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} required disabled={demoMode || busy} /></label></div>
        <label>具体型号或款式<input value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} required placeholder={selectedListing?.model ? undefined : "请核对后填写，不能只写品牌"} disabled={demoMode || busy} /></label>
        <div className="form-row"><label>参考金额<input name="amount" type="number" min="0.01" step="0.01" required disabled={demoMode || busy} /></label><label>币种<input name="currency" defaultValue="CNY" maxLength={3} required disabled={demoMode || busy} /></label></div>
        <label>价格口径<select name="priceType" defaultValue="actual_sale" disabled={demoMode || busy}>{Object.entries(priceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>逐条样本（每行一条）<textarea name="sampleEvidence" rows={4} required disabled={demoMode || busy} placeholder={"来源或匿名成交编号 | 金额 | YYYY-MM-DD\n自有成交 A | 79000 | 2026-09-01\n自有成交 B | 80500 | 2026-09-02\n自有成交 C | 77500 | 2026-09-03"} /><small>系统按样本行数计数；已成交参考价至少 3 条才可进入价格过滤。勿填写买卖双方联系方式。</small></label>
        <div className="form-row"><label>可比成色<select name="conditionGrade" defaultValue="unknown" disabled={demoMode || busy}>{Object.entries(gradeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>生产年份（如已核实）<input name="productionYear" type="number" min={1900} max={new Date().getFullYear()} disabled={demoMode || busy} /></label></div>
        <label>附件（顿号或逗号分隔）<input name="accessories" maxLength={500} placeholder="例如：盒、保卡、票据" disabled={demoMode || busy} /></label>
        <div className="form-row"><label>样本市场<select name="market" defaultValue="CN-mainland" disabled={demoMode || busy}><option value="CN-mainland">中国大陆二手市场</option><option value="other">其他市场（仅参考）</option></select></label><label>地区说明<input name="marketRegion" maxLength={80} placeholder="例如：广州 / 全国" disabled={demoMode || busy} /></label></div>
        <label>成色、年份与附件差异<input name="conditionNote" maxLength={500} required placeholder="说明可比条件与调整依据" disabled={demoMode || busy} /></label>
        <div className="form-row"><label>来源名称<input name="sourceLabel" maxLength={120} required placeholder="例如：商家自有成交记录" disabled={demoMode || busy} /></label><label>观察时间<input name="observedAt" type="datetime-local" required disabled={demoMode || busy} /></label></div>
        <label>来源链接（可选）<input name="sourceUrl" type="url" placeholder="https://" disabled={demoMode || busy} /></label>
        <label>录入来源<select name="origin" defaultValue="manual" disabled={demoMode || busy}><option value="manual">人工录入</option><option value="ai-assisted">AI 辅助补充（待复核）</option></select></label>
        <label>录入/修改原因<input name="changeReason" maxLength={500} required disabled={demoMode || busy} /></label>
        <button className="button button-primary button-small" type="submit" disabled={demoMode || busy}>保存为待复核参考价</button>
      </form>
    </details>
    <div className="price-reference-list">
      {sortedReferences.map((item) => <details className="price-reference-item" key={item.id} data-status={item.status} data-superseded={item.superseded || undefined} id={`price-reference-${item.id}`}>
        <summary>
          <span className="price-reference-title"><strong>{item.brand} {item.model}</strong><b>{item.amount.toLocaleString("zh-CN")} {item.currency}</b></span>
          <small>{categoryLabels[item.category] ?? item.category} · {priceTypeLabels[item.priceType] ?? item.priceType} · {statusLabel(item)}{item.origin === "ai-assisted" ? " · AI 辅助" : ""} · v{item.version}</small>
        </summary>
        <div className="price-reference-item-body">
          <p>{item.conditionNote}</p>
          <small>{gradeLabels[item.conditionGrade] ?? item.conditionGrade}{item.productionYear ? ` · ${item.productionYear} 年` : ""} · {item.market === "CN-mainland" ? "中国大陆二手市场" : "其他市场"}{item.marketRegion ? ` · ${item.marketRegion}` : ""} · 附件：{item.accessories.join("、") || "未记录"} · {item.listingId ? "已关联线索" : "型号资料"}</small>
          <small>{item.sourceLabel} · {item.sampleCount} 条样本 · {new Date(item.observedAt).toLocaleDateString("zh-CN")}</small>
          <details className="rule-version-history"><summary>查看逐条样本（{item.sampleEvidence.length}）</summary><ul>{item.sampleEvidence.map((sample, index) => <li key={`${sample.sourceLabel}-${index}`}>{sample.sourceLabel} · {sample.amount.toLocaleString("zh-CN")} {item.currency} · {sample.observedAt}</li>)}</ul></details>
          {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源</a>}
          <small>变更依据：{item.changeReason}</small>
          <div className="form-actions">{item.status === "pending" && !item.superseded && <button type="button" className="button button-secondary button-small" disabled={demoMode || busy} onClick={() => void review(item.id, "approve")}>人工批准</button>}
            {item.status === "approved" && (!item.superseded || item.applied) && <button type="button" className="button button-ghost button-small" disabled={demoMode || busy} onClick={() => void review(item.id, "disable")}>停用参考价</button>}</div>
        </div>
      </details>)}
      {references.length === 0 && <p className="empty-state">暂无参考价。展开上方表单可先录入型号资料；有合格线索后再关联并复核。</p>}
    </div>
  </section>;
}
