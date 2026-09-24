"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CircleNotch, Database, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { XianyuAuthRequiredNotice } from "@/components/xianyu-auth-required-notice";

interface ImportResult {
  keyword: string;
  loggedIn: boolean;
  totalResults: number;
  newRecords: number;
  importedRecords: number;
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
  const [keyword, setKeyword] = useState("劳力士");
  const [category, setCategory] = useState("watch");
  const [city, setCity] = useState("广州");
  const [minPrice, setMinPrice] = useState("5000");
  const [maxPrice, setMaxPrice] = useState("150000");
  const [maxPages, setMaxPages] = useState("1");
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "required" | "unavailable">("checking");
  const [result, setResult] = useState<ImportResult | null>(null);
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
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/sources/xianyu/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword,
          category,
          city: city.trim() || undefined,
          minPrice: optionalNumber(minPrice),
          maxPrice: optionalNumber(maxPrice),
          maxPages: Number(maxPages),
          publishDays: 3,
        }),
      });
      const payload = (await response.json()) as { result?: ImportResult; error?: string; code?: string };
      if (payload.code === "XIANYU_AUTH_REQUIRED") {
        setAuthState("required");
        return;
      }
      if (!response.ok || !payload.result) throw new Error(payload.error || "采集请求失败。");
      setResult(payload.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "采集请求失败。");
    } finally {
      setLoading(false);
    }
  }

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
          <span>关键词</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={40} required />
        </label>
        <label>
          <span>业务品类</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="watch">腕表</option>
            <option value="bag">箱包</option>
            <option value="jewelry">饰品</option>
          </select>
        </label>
        <label>
          <span>城市</span>
          <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={20} />
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
          </select>
        </label>
        <button className="button button-primary" type="submit" disabled={loading || !keyword.trim() || authState !== "authenticated"}>
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
      {result && (
        <div role="status">
          <div className="source-result">
            <div><span>搜索结果</span><strong>{result.totalResults}</strong></div>
            <div><span>采集器新增</span><strong>{result.newRecords}</strong></div>
            <div><span>成功入库</span><strong>{result.importedRecords}</strong></div>
            <div><span>真实商品</span><strong>{result.items.length}</strong></div>
            <a href="/leads">查看线索库 <ArrowRight size={16} /></a>
          </div>
          {result.items.length > 0 && (
            <div className="source-items" aria-label="本次闲鱼真实商品">
              {result.items.map((item) => (
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
