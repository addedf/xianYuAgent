"use client";

import { useMemo, useState } from "react";
import {
  ArrowSquareOut,
  BookOpenText,
  CheckCircle,
  ImageSquare,
  Info,
  MagnifyingGlass,
  SealWarning,
  UserCircleCheck,
  XCircle,
} from "@phosphor-icons/react";
import { RiskChip } from "@/components/status-chip";
import type { ListingAssessment, MarketplaceListing, RecommendedAction } from "@/src/domain/listing";

type AssessedListing = { listing: MarketplaceListing; assessment: ListingAssessment };
type Filter = "all" | RecommendedAction;

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });
const categoryLabels = { watch: "腕表", bag: "箱包", jewelry: "饰品" };
const actionLabels: Record<RecommendedAction, string> = {
  notify: "建议提醒",
  review: "需要复核",
  archive: "留档观察",
  skip: "默认跳过",
};

export function LeadWorkbench({ items }: { items: AssessedListing[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState(items[0]?.listing.id ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [knowledgeCandidate, setKnowledgeCandidate] = useState(false);

  const filtered = useMemo(
    () => items.filter(({ assessment }) => filter === "all" || assessment.recommendedAction === filter),
    [filter, items],
  );
  const selected = items.find(({ listing }) => listing.id === selectedId) ?? filtered[0] ?? items[0];

  if (!selected) {
    return <div className="empty-state">当前没有可审阅线索。</div>;
  }

  const { listing, assessment } = selected;

  function recordFeedback(value: string) {
    setFeedback(value);
    setKnowledgeCandidate(value !== "判断正确");
  }

  return (
    <div className="lead-workbench">
      <section className="lead-queue" aria-label="线索队列">
        <div className="queue-toolbar">
          <div className="queue-search">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <span>搜索品牌、型号或卖家</span>
          </div>
          <div className="filter-tabs" role="group" aria-label="按建议动作筛选">
            {(["all", "notify", "review", "skip"] as const).map((value) => (
              <button
                className="filter-tab"
                data-active={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {value === "all" ? "全部" : actionLabels[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="queue-list">
          {filtered.map((item) => {
            const active = item.listing.id === listing.id;
            return (
              <button
                className="queue-item"
                data-active={active}
                id={item.listing.id}
                key={item.listing.id}
                onClick={() => {
                  setSelectedId(item.listing.id);
                  setFeedback(null);
                  setKnowledgeCandidate(false);
                }}
                type="button"
              >
                <span className={`category-mark category-${item.listing.category}`} aria-hidden="true">
                  {categoryLabels[item.listing.category].slice(0, 1)}
                </span>
                <span className="queue-item-main">
                  <span className="queue-item-topline">
                    <strong>{item.listing.brand} {item.listing.model}</strong>
                    <b>{item.assessment.scores.totalOpportunity}</b>
                  </span>
                  <span className="queue-item-title">{item.listing.title}</span>
                  <span className="queue-item-meta">{currency.format(item.listing.price)} · {item.listing.region}</span>
                  <RiskChip level={item.assessment.riskLevel} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="lead-detail" aria-live="polite">
        <header className="lead-detail-header">
          <div>
            <div className="lead-kicker">
              <span>{categoryLabels[listing.category]}</span>
              <span>{listing.externalId}</span>
            </div>
            <h2>{listing.brand} {listing.model}</h2>
            <p>{listing.title}</p>
          </div>
          <button className="button button-secondary" type="button" disabled title="真实适配器接入后可用">
            打开原帖
            <ArrowSquareOut size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="lead-facts">
          <div><span>挂牌价</span><strong>{currency.format(listing.price)}</strong></div>
          <div><span>参考区间</span><strong>{listing.marketReferencePrice ? currency.format(listing.marketReferencePrice) : "暂无"}</strong></div>
          <div><span>区域 / 距离</span><strong>{listing.region}{listing.distanceKm ? ` · ${listing.distanceKm}km` : ""}</strong></div>
          <div><span>卖家</span><strong>{listing.seller.displayName} · {listing.seller.activeListingCount} 条发布</strong></div>
        </div>

        <div className="assessment-summary">
          <div className="opportunity-score">
            <span>综合机会分</span>
            <strong>{assessment.scores.totalOpportunity}</strong>
            <small>/ 100</small>
          </div>
          <div className="assessment-copy">
            <RiskChip level={assessment.riskLevel} />
            <h3>{actionLabels[assessment.recommendedAction]}</h3>
            <p>{assessment.summary}</p>
          </div>
        </div>

        <div className="score-grid" aria-label="分项评分">
          <div><span>个人卖家概率</span><strong>{assessment.scores.personalSeller}</strong><small>账号与文案</small></div>
          <div><span>疑假风险</span><strong>{assessment.scores.authenticityRisk}</strong><small>越高风险越大</small></div>
          <div><span>信息充分度</span><strong>{assessment.scores.informationCompleteness}</strong><small>图片与来源</small></div>
          <div><span>利润机会</span><strong>{assessment.scores.profitOpportunity}</strong><small>仅作初筛参考</small></div>
        </div>

        <div className="detail-columns">
          <section className="evidence-section">
            <div className="section-heading compact-heading">
              <div>
                <h3>判断依据</h3>
                <p>按影响程度排序，结论可被人工纠正。</p>
              </div>
              <span>规则 {assessment.rulesetVersion}</span>
            </div>
            <div className="evidence-list">
              {assessment.evidence.map((item) => {
                const Icon = item.kind === "positive" ? CheckCircle : item.kind === "risk" ? SealWarning : Info;
                return (
                  <div className="evidence-row" data-kind={item.kind} key={item.code}>
                    <Icon size={20} weight="fill" aria-hidden="true" />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                      <small>来源：{item.source} · 影响 {item.scoreImpact > 0 ? "+" : ""}{item.scoreImpact}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="review-section">
            <div className="review-block">
              <h3><ImageSquare size={19} aria-hidden="true" /> 建议补充</h3>
              {assessment.missingInformation.length > 0 ? (
                <ul>{assessment.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : (
                <p className="complete-message">当前基础信息较完整，仍需实物鉴定。</p>
              )}
            </div>

            <div className="review-block">
              <h3><UserCircleCheck size={19} aria-hidden="true" /> 人工反馈</h3>
              <p>反馈不会直接改规则，而是先形成待复核经验候选。</p>
              <div className="feedback-actions">
                <button type="button" onClick={() => recordFeedback("判断正确")}><CheckCircle size={17} />判断正确</button>
                <button type="button" onClick={() => recordFeedback("需要纠正")}><XCircle size={17} />需要纠正</button>
                <button type="button" onClick={() => recordFeedback("已成交")}><BookOpenText size={17} />已成交</button>
              </div>
              {feedback && <div className="feedback-notice">已记录“{feedback}”（演示模式，尚未持久化）。</div>}
            </div>

            {knowledgeCandidate && (
              <div className="knowledge-candidate">
                <BookOpenText size={20} weight="fill" aria-hidden="true" />
                <div>
                  <strong>已生成经验候选</strong>
                  <p>商品特征、原判断与人工反馈将组成案例草稿，等待审核后再进入规则版本。</p>
                  <a href="/knowledge">前往知识库复核</a>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

