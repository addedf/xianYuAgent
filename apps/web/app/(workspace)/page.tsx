import Link from "next/link";
import {
  ArrowRight,
  BellRinging,
  ClockCountdown,
  Database,
  Eye,
  Lightning,
} from "@phosphor-icons/react/dist/ssr";
import { RiskChip } from "@/components/status-chip";
import { assessedDemoListings, demoKnowledgeEntries, demoMonitorTasks } from "@/src/data/demo";

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });

function categoryMark(category: string) {
  return category === "watch" ? "表" : category === "bag" ? "包" : "饰";
}

export default function DashboardPage() {
  const priorityLeads = assessedDemoListings
    .filter(({ assessment }) => assessment.recommendedAction !== "archive")
    .sort((a, b) => b.assessment.scores.totalOpportunity - a.assessment.scores.totalOpportunity);
  const notifyCount = priorityLeads.filter(({ assessment }) => assessment.recommendedAction === "notify").length;
  const reviewCount = priorityLeads.filter(({ assessment }) => assessment.recommendedAction === "review").length;

  return (
    <div className="page-stack">
      <header className="page-header page-header-split">
        <div>
          <p className="context-line">2026 年 8 月 30 日 · 广州 / 佛山</p>
          <h1>今日机会概览</h1>
          <p>先处理高价值新线索，再把人工判断沉淀为下一次可复用的标准。</p>
        </div>
        <div className="page-header-actions">
          <span className="mode-badge">演示数据</span>
          <Link className="button button-primary" href="/leads">
            审阅新线索
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="signal-strip" aria-label="今日关键指标">
        <div className="signal-item">
          <span>今日新增</span>
          <strong>28</strong>
          <small>最近一条 2 分钟前</small>
        </div>
        <div className="signal-item signal-emphasis">
          <span>建议提醒</span>
          <strong>{notifyCount}</strong>
          <small>满足当前规则阈值</small>
        </div>
        <div className="signal-item">
          <span>等待人工复核</span>
          <strong>{reviewCount}</strong>
          <small>信息不足或中风险</small>
        </div>
        <div className="signal-item">
          <span>重复拦截</span>
          <strong>7</strong>
          <small>商品与图片双重去重</small>
        </div>
      </section>

      <section className="control-banner" aria-label="系统运行状态">
        <div className="control-banner-main">
          <span className="live-indicator" aria-hidden="true" />
          <div>
            <strong>监控链路正在低频运行</strong>
            <span>最近扫描 10:29:30 · 水位线正常 · 主动询价保持关闭</span>
          </div>
        </div>
        <Link href="/settings">检查连接状态</Link>
      </section>

      <div className="dashboard-grid">
        <section className="panel panel-main">
          <div className="section-heading">
            <div>
              <h2>优先处理</h2>
              <p>按机会分排序；高风险不会因低价进入自动联系。</p>
            </div>
            <Link href="/leads">查看全部</Link>
          </div>

          <div className="lead-table" role="table" aria-label="优先线索">
            <div className="lead-table-head" role="row">
              <span role="columnheader">商品与卖家</span>
              <span role="columnheader">挂牌价</span>
              <span role="columnheader">判断</span>
              <span role="columnheader">机会分</span>
            </div>
            {priorityLeads.map(({ listing, assessment }) => (
              <Link className="lead-table-row" role="row" href={`/leads#${listing.id}`} key={listing.id}>
                <span className="lead-identity" role="cell">
                  <span className={`category-mark category-${listing.category}`} aria-hidden="true">
                    {categoryMark(listing.category)}
                  </span>
                  <span>
                    <strong>{listing.brand} {listing.model}</strong>
                    <small>{listing.seller.displayName} · {listing.region}</small>
                  </span>
                </span>
                <span className="lead-price" role="cell">{currency.format(listing.price)}</span>
                <span role="cell"><RiskChip level={assessment.riskLevel} /></span>
                <span className="lead-score" role="cell">
                  <strong>{assessment.scores.totalOpportunity}</strong>
                  <small>/ 100</small>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <aside className="dashboard-side">
          <section className="panel compact-panel">
            <div className="section-heading">
              <div>
                <h2>当前任务</h2>
                <p>复用闲鱼既有搜索条件</p>
              </div>
            </div>
            <div className="task-list">
              {demoMonitorTasks.map((task) => (
                <div className="task-row" key={task.id}>
                  <div className="task-state"><span aria-hidden="true" /></div>
                  <div>
                    <strong>{task.name}</strong>
                    <span>{task.keywords.join("、")}</span>
                    <small>{task.regions.join(" / ")} · 5 分钟一次</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel compact-panel operational-panel">
            <div className="section-heading">
              <div>
                <h2>今日链路</h2>
                <p>每一步都有独立状态</p>
              </div>
            </div>
            <ul className="operation-list">
              <li><Eye size={18} aria-hidden="true" /><span><strong>发现</strong><small>最新结果增量识别</small></span><b>正常</b></li>
              <li><Lightning size={18} aria-hidden="true" /><span><strong>判断</strong><small>规则集 2026.08.30-v1</small></span><b>正常</b></li>
              <li><BellRinging size={18} aria-hidden="true" /><span><strong>通知</strong><small>等待配置企业微信</small></span><b className="state-pending">待配置</b></li>
              <li><Database size={18} aria-hidden="true" /><span><strong>沉淀</strong><small>{demoKnowledgeEntries.length} 条演示知识</small></span><b>可用</b></li>
            </ul>
          </section>

          <section className="knowledge-callout">
            <ClockCountdown size={21} weight="fill" aria-hidden="true" />
            <div>
              <strong>3 条判断可转为经验候选</strong>
              <p>先人工确认，再生成新版本；Agent 不会自行覆盖现有规则。</p>
              <Link href="/knowledge">进入经验知识库</Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

