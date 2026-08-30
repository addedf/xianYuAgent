"use client";

import { useState } from "react";
import { ArrowRight, CircleNotch, Database, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";

interface ImportResult {
  keyword: string;
  loggedIn: boolean;
  totalResults: number;
  newRecords: number;
  importedRecords: number;
  skippedRecords: number;
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          maxPages: 1,
          publishDays: 3,
        }),
      });
      const payload = (await response.json()) as { result?: ImportResult; error?: string };
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
          <h2>闲鱼真实数据入口</h2>
          <p>手动触发一次低频只读搜索；新增商品经规范化、去重后写入 PostgreSQL。</p>
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
        <button className="button button-primary" type="submit" disabled={loading || !keyword.trim()}>
          {loading ? <CircleNotch className="spin" size={17} /> : <MagnifyingGlass size={17} />}
          {loading ? "正在采集" : "搜索并导入"}
        </button>
      </form>

      <div className="source-boundary-note">
        <WarningCircle size={18} weight="fill" aria-hidden="true" />
        <p>本入口不接收 Cookie，也不处理验证码。登录、扫脸和会话文件只留在独立本地采集器中。</p>
      </div>

      {error && <div className="error-state" role="alert"><WarningCircle size={20} weight="fill" />{error}</div>}
      {result && (
        <div className="source-result" role="status">
          <div><span>搜索结果</span><strong>{result.totalResults}</strong></div>
          <div><span>采集器新增</span><strong>{result.newRecords}</strong></div>
          <div><span>成功入库</span><strong>{result.importedRecords}</strong></div>
          <div><span>登录状态</span><strong>{result.loggedIn ? "已登录" : "未登录"}</strong></div>
          <a href="/leads">查看真实线索 <ArrowRight size={16} /></a>
        </div>
      )}
    </section>
  );
}
