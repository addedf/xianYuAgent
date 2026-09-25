"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CircleNotch, Database, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { XianyuAuthRequiredNotice } from "@/components/xianyu-auth-required-notice";
import { cityOptions, parseSearchKeywords, provinceOptions, resolveSearchLocation, SEARCH_KEYWORD_LIMIT } from "@/src/domain/search-conditions";

interface ImportResult {
  keyword: string;
  loggedIn: boolean;
  totalResults: number;
  newRecords: number;
  importedRecords: number;
  filteredRecords?: number;
  pendingEvaluation?: number;
  enrichedDetails?: number;
  blockedDetails?: number;
  sellerProfiles?: { fetched: number; skipped: number; failed: number; cooldown: number };
  skippedRecords: number;
  items: Array<{
    externalId: string;
    title: string;
    price: number;
    region: string;
    publishedAt: string;
    sourceUrl?: string;
  }>;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function XianyuSourcePanel() {
  const [keywordText, setKeywordText] = useState("");
  const [provinceCode, setProvinceCode] = useState("440000");
  const [cityCode, setCityCode] = useState("440100");
  const [minPrice, setMinPrice] = useState("5000");
  const [maxPrice, setMaxPrice] = useState("150000");
  const [maxPages, setMaxPages] = useState("1");
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "required" | "unavailable">("checking");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refreshAuth() {
      try {
        const response = await fetch("/api/sources/xianyu/auth", { cache: "no-store" });
        const payload = (await response.json()) as { auth?: { loggedIn: boolean } };
        if (!cancelled) {
          setAuthState(response.ok
            ? payload.auth?.loggedIn === true ? "authenticated" : "required"
            : "unavailable");
        }
      } catch {
        if (!cancelled) setAuthState("unavailable");
      }
    }
    refreshAuth();
    const timer = window.setInterval(refreshAuth, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  async function runImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let keywords: string[];
    let location: ReturnType<typeof resolveSearchLocation>;
    try {
      keywords = parseSearchKeywords(keywordText);
      location = resolveSearchLocation(provinceCode, cityCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜索条件不正确。");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      for (const [index, keyword] of keywords.entries()) {
        setProgress(`正在搜索第 ${index + 1}/${keywords.length} 个关键词：${keyword}`);
        const response = await fetch("/api/sources/xianyu/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            keyword,
            ...location,
            minPrice: optionalNumber(minPrice),
            maxPrice: optionalNumber(maxPrice),
            maxPages: Number(maxPages),
            publishDays: 3,
          }),
        });
        const payload = (await response.json()) as { result?: ImportResult; error?: string; code?: string };
        if (payload.code === "XIANYU_AUTH_REQUIRED") setAuthState("required");
        if (!response.ok || !payload.result) throw new Error(`${keyword}：${payload.error || "采集请求失败。"}`);
        setResults((current) => [...current, payload.result!]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "采集请求失败。");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const totals = results.reduce((current, result) => ({
    totalResults: current.totalResults + result.totalResults,
    newRecords: current.newRecords + result.newRecords,
    importedRecords: current.importedRecords + result.importedRecords,
    filteredRecords: current.filteredRecords + (result.filteredRecords ?? 0),
    pendingEvaluation: current.pendingEvaluation + (result.pendingEvaluation ?? 0),
    enrichedDetails: current.enrichedDetails + (result.enrichedDetails ?? 0),
    blockedDetails: current.blockedDetails + (result.blockedDetails ?? 0),
    sellerProfilesFetched: current.sellerProfilesFetched + (result.sellerProfiles?.fetched ?? 0),
    sellerProfilesFailed: current.sellerProfilesFailed + (result.sellerProfiles?.failed ?? 0),
  }), { totalResults: 0, newRecords: 0, importedRecords: 0, filteredRecords: 0, pendingEvaluation: 0, enrichedDetails: 0, blockedDetails: 0, sellerProfilesFetched: 0, sellerProfilesFailed: 0 });
  const items = [...new Map(results.flatMap((result) => result.items).map((item) => [item.externalId, item])).values()];

  return (
    <section className="panel source-panel">
      <div className="section-heading">
        <div>
          <h2>闲鱼真实数据入口 · 批量评估</h2>
          <p>采集结果写入 PostgreSQL 时由规则引擎整理事实与评分选项，JEV 主评分并保存；相同内容不会在后续扫描中重复评分。</p>
        </div>
        <Database size={22} weight="fill" aria-hidden="true" />
      </div>

      <form className="source-search-form" onSubmit={runImport}>
        <label>
          <span>搜索关键词（每行一个，最多 {SEARCH_KEYWORD_LIMIT} 个）</span>
          <textarea value={keywordText} onChange={(event) => setKeywordText(event.target.value)} rows={3} placeholder={"例如：劳力士 日志型\n欧米茄 海马\nLV 发财桶"} required />
        </label>
        <label>
          <span>搜索地点 · 省份</span>
          <select value={provinceCode} onChange={(event) => { setProvinceCode(event.target.value); setCityCode(""); }}>
            <option value="">全国</option>
            {provinceOptions.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>城市</span>
          <select value={cityCode} onChange={(event) => setCityCode(event.target.value)} disabled={!provinceCode}>
            <option value="">{provinceCode ? "全省" : "全国"}</option>
            {cityOptions(provinceCode).map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>最低价</span>
          <input inputMode="numeric" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} />
        </label>
        <label>
          <span>最高价</span>
          <input inputMode="numeric" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} />
        </label>
        <label>
          <span>扫描页数</span>
          <select value={maxPages} onChange={(event) => setMaxPages(event.target.value)}>
            <option value="1">1 页</option>
            <option value="2">2 页</option>
            <option value="3">3 页</option>
            <option value="5">5 页</option>
            <option value="8">8 页</option>
            <option value="10">10 页</option>
          </select>
        </label>
        <button className="button button-primary" type="submit" disabled={loading || !keywordText.trim() || authState !== "authenticated"}>
          {loading ? <CircleNotch className="spin" size={17} /> : <MagnifyingGlass size={17} />}
          {loading
            ? "正在采集"
            : authState === "authenticated"
              ? "搜索并导入"
              : authState === "checking"
                ? "正在确认登录"
                : authState === "required"
                  ? "请先连接闲鱼"
                  : "无法确认登录状态"}
        </button>
      </form>
      <p className="source-search-hint">多个关键词将依次单独搜索；空格可保留在同一关键词内。选择“全国”不限制地点，选择省份后可继续指定城市。</p>
      {progress && <p className="source-search-progress" role="status"><CircleNotch className="spin" size={15} />{progress}</p>}

      {authState === "required" && <XianyuAuthRequiredNotice />}
      {authState === "unavailable" && (
        <div className="error-state" role="alert">
          <WarningCircle size={20} weight="fill" />
          无法确认闲鱼登录状态，请检查上方采集器连接后再试。
        </div>
      )}

      <div className="source-boundary-note">
        <WarningCircle size={18} weight="fill" aria-hidden="true" />
        <p>仅在闲鱼登录态有效时搜索；登录、核身和会话文件只留在独立本地采集器中。</p>
      </div>

      {error && <div className="error-state" role="alert"><WarningCircle size={20} weight="fill" />{error}</div>}
      {results.length > 0 && (
        <div role="status">
          <p className="source-search-summary">已完成 {results.length} 个关键词；以下搜索结果为各次查询合计，可能包含重复商品。</p>
          <div className="source-result">
            <div><span>搜索结果合计</span><strong>{totals.totalResults}</strong></div>
            <div><span>采集器新增</span><strong>{totals.newRecords}</strong></div>
            <div><span>成功入库</span><strong>{totals.importedRecords}</strong></div>
            <div><span>已过滤</span><strong>{totals.filteredRecords}</strong></div>
            <div><span>待评分</span><strong>{totals.pendingEvaluation}</strong></div>
            <a href="/leads">查看线索库 <ArrowRight size={16} /></a>
          </div>
          <div className="source-search-breakdown" aria-label="各关键词搜索结果">
            {results.map((result) => <span key={result.keyword}>{result.keyword}：{result.totalResults} 条结果，{result.importedRecords} 条入库</span>)}
          </div>
          {totals.pendingEvaluation > 0 && (
            <div className="notice-state" role="status">本轮有 {totals.pendingEvaluation} 条线索暂时没有 JEV 评分（评分不可用或被限频）；它们会保持「待模型评分」状态，恢复后的下一次扫描自动补评。</div>
          )}
          {(totals.blockedDetails > 0 || totals.sellerProfilesFailed > 0) && (
            <div className="notice-state" role="status">本轮成功补全详情 {totals.enrichedDetails} 条、卖家主页 {totals.sellerProfilesFetched} 个；详情限流 {totals.blockedDetails} 条、主页抓取失败 {totals.sellerProfilesFailed} 个。缺少主页数据时，系统无法根据卖家主页商品分布判断是否为非个人卖家。</div>
          )}
          {items.length > 0 && (
            <div className="source-items" aria-label="本次闲鱼真实商品">
              {items.map((item) => (
                <article key={item.externalId}>
                  <div>
                    <span>{item.region} · {new Date(item.publishedAt).getUTCFullYear() > 1970 ? new Date(item.publishedAt).toLocaleString("zh-CN") : "发布时间未知"}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <strong>{new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(item.price)}</strong>
                  {item.sourceUrl && <a href={item.sourceUrl} rel="noreferrer" target="_blank">打开闲鱼原帖 <ArrowRight size={15} /></a>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
