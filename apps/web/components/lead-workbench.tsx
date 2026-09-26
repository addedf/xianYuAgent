"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOut,
  BookOpenText,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ImageSquare,
  Info,
  MagnifyingGlass,
  Prohibit,
  SealWarning,
  UserCircleCheck,
  X,
} from "@phosphor-icons/react";
import { RiskChip } from "@/components/status-chip";
import type { ListingAssessment, MarketplaceListing, RecommendedAction } from "@/src/domain/listing";
import { exclusionReasonLabel, identityTypeLabel } from "@/src/domain/seller-identity";
import { nonPersonalSellerReason } from "@/src/domain/seller";
import { DEFAULT_SELLER_RULE_THRESHOLDS, type SellerRuleThresholds } from "@/src/domain/seller-rules";

type AssessedListing = { listing: MarketplaceListing; assessment: ListingAssessment };
type Filter = "all" | RecommendedAction | "pending" | "filtered" | "excluded" | "ignored";

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });
const categoryLabels = { watch: "腕表", bag: "箱包", jewelry: "饰品", other: "其他" };
const actionLabels: Record<RecommendedAction, string> = {
  notify: "建议提醒",
  review: "需要复核",
  archive: "留档观察",
  skip: "默认跳过",
};
const filterLabels: Record<Filter, string> = {
  all: "全部",
  ...actionLabels,
  pending: "待评分",
  filtered: "已过滤",
  excluded: "卖家已排除",
  ignored: "已忽略",
};
const evidenceSourceLabels: Record<string, string> = { rule: "规则", knowledge: "知识", market: "市场", seller: "卖家", model: "模型" };

function ListingPhoto({ src, alt, category, variant }: { src?: string; alt: string; category: keyof typeof categoryLabels; variant: "thumb" | "card" | "lightbox" }) {
  const [failed, setFailed] = useState(false);
  const fallback = categoryLabels[category].slice(0, 1);

  if (!src || failed) {
    return (
      <span className={`listing-photo listing-photo-${variant} listing-photo-fallback category-${category}`} aria-label={src ? "图片加载失败" : "暂无商品图片"}>
        <span className="category-mark" aria-hidden="true">{fallback}</span>
      </span>
    );
  }

  return (
    <span className={`listing-photo listing-photo-${variant}`}>
      <Image
        src={src}
        alt={alt}
        width={variant === "thumb" ? 52 : variant === "card" ? 420 : 1200}
        height={variant === "thumb" ? 52 : variant === "card" ? 280 : 900}
        loading={variant === "thumb" ? "lazy" : "eager"}
        style={variant === "lightbox" ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" } : undefined}
        unoptimized
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function LeadWorkbench({ items, demoMode = true, confidenceThreshold = 55, sellerThresholds = DEFAULT_SELLER_RULE_THRESHOLDS }: { items: AssessedListing[]; demoMode?: boolean; confidenceThreshold?: number; sellerThresholds?: SellerRuleThresholds }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState(items[0]?.listing.id ?? "");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"manual-feedback" | "rule-candidate">("manual-feedback");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackLabel, setFeedbackLabel] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [knowledgeCandidate, setKnowledgeCandidate] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState<"manual-suspicion" | "merchant-name">("manual-suspicion");
  const [blacklistNote, setBlacklistNote] = useState("");
  const [blacklistBusy, setBlacklistBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // 人工处理状态（已忽略/卖家已排除）独立于采集刷新与模型结果：
  // 默认「全部」不再展示，只有对应标签下可见；重扫或重评不会重置（方案 8）。
  const filtered = useMemo(
    () => items.filter(({ listing, assessment }) => {
      if (filter === "filtered") return Boolean(assessment.filterCode);
      if (filter === "pending") return !assessment.filterCode && assessment.pending === true;
      if (filter === "excluded") return Boolean(listing.sellerExcluded);
      if (filter === "ignored") return listing.handling === "ignored";
      if (filter === "all") return !assessment.filterCode && !listing.sellerExcluded && listing.handling !== "ignored";
      return !assessment.filterCode && !listing.sellerExcluded && listing.handling !== "ignored" && assessment.recommendedAction === filter;
    }),
    [filter, items],
  );
  const selected = items.find(({ listing }) => listing.id === selectedId)
    ?? filtered[0]
    ?? items.find(({ assessment }) => !assessment.filterCode)
    ?? items[0];

  const photos = selected?.listing.imageUrls ?? [];
  const sellerTypeReason = selected ? nonPersonalSellerReason(selected.listing.seller, sellerThresholds, selected.listing.category) : null;
  const completeProfile = selected?.listing.seller.signalScope === "complete-profile";
  const profileMixText = selected
    ? Object.entries(selected.listing.seller.profileCategoryMix ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name} ${count}`)
      .join(" · ")
    : "";

  useEffect(() => {
    if (!lightboxOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft" && photos.length > 1) setPhotoIndex((current) => (current - 1 + photos.length) % photos.length);
      if (event.key === "ArrowRight" && photos.length > 1) setPhotoIndex((current) => (current + 1) % photos.length);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen, photos.length]);

  if (!selected) {
    return <div className="empty-state">当前没有可审阅线索。</div>;
  }

  const { listing, assessment } = selected;
  const selectedPhotoIndex = photos.length > 0 ? Math.min(photoIndex, photos.length - 1) : 0;
  const activePhoto = photos[selectedPhotoIndex] ?? photos[0];
  const photoWindowSize = Math.min(4, Math.max(photos.length, 1));
  const photoWindowStart = Math.min(
    Math.max(selectedPhotoIndex - Math.floor(photoWindowSize / 2), 0),
    Math.max(photos.length - photoWindowSize, 0),
  );
  const visiblePhotos = photos.slice(photoWindowStart, photoWindowStart + photoWindowSize);

  function movePhoto(delta: number) {
    if (photos.length < 2) return;
    setPhotoIndex((current) => (current + delta + photos.length) % photos.length);
  }

  async function submitFeedback() {
    const reason = feedbackText.trim();
    if (!reason || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackNotice(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          assessmentId: assessment.assessmentId,
          feedbackType,
          reason,
          finalLabel: feedbackLabel.trim() || undefined,
          knowledgeCandidate: feedbackType === "rule-candidate" ? { text: reason, label: feedbackLabel.trim() || undefined } : undefined,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "反馈保存失败，请重试。");
      setFeedbackNotice({ kind: "success", text: feedbackType === "rule-candidate" ? "规则候选已提交，等待知识库复核。" : "人工反馈已保存。" });
      setFeedbackText("");
      setFeedbackLabel("");
      setKnowledgeCandidate(feedbackType === "rule-candidate");
    } catch (error) {
      setFeedbackNotice({ kind: "error", text: error instanceof Error ? error.message : "反馈保存失败，请重试。" });
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  function resetReviewState() {
    setPhotoIndex(0);
    setLightboxOpen(false);
    setFeedbackText("");
    setFeedbackLabel("");
    setFeedbackNotice(null);
    setKnowledgeCandidate(false);
    setBlacklistOpen(false);
    setBlacklistNote("");
    setActionNotice(null);
  }

  async function submitBlacklist() {
    const sellerRecordId = listing.seller.sellerRecordId;
    if (!sellerRecordId || blacklistBusy) return;
    setBlacklistBusy(true);
    setActionNotice(null);
    try {
      const response = await fetch("/api/sellers/blacklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sellerId: sellerRecordId, reason: blacklistReason, note: blacklistNote.trim() || undefined }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; affectedActiveListings?: number; scopeNotice?: string };
      if (!response.ok) throw new Error(result.error ?? "拉黑保存失败，请重试。");
      setActionNotice({
        kind: "success",
        text: `已拉黑卖家 ${listing.seller.displayName}；存量 ${result.affectedActiveListings ?? 0} 条线索已移出待处理。${result.scopeNotice ?? ""}`,
      });
      setBlacklistOpen(false);
      setBlacklistNote("");
      router.refresh();
    } catch (error) {
      setActionNotice({ kind: "error", text: error instanceof Error ? error.message : "拉黑保存失败，请重试。" });
    } finally {
      setBlacklistBusy(false);
    }
  }

  async function updateHandling(handling: "ignored" | "pending" | "none") {
    if (blacklistBusy) return;
    setBlacklistBusy(true);
    setActionNotice(null);
    try {
      const response = await fetch("/api/listings/handling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: listing.id, handling }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "处理状态保存失败，请重试。");
      setActionNotice({
        kind: "success",
        text: handling === "ignored" ? "已忽略该商品：不再进入待处理；该卖家后续新货仍会正常筛选。"
          : handling === "pending" ? "已标记暂时待定：重扫与重评不会把它重置回未读。"
          : "已取消人工处理状态。",
      });
      router.refresh();
    } catch (error) {
      setActionNotice({ kind: "error", text: error instanceof Error ? error.message : "处理状态保存失败，请重试。" });
    } finally {
      setBlacklistBusy(false);
    }
  }

  return (
    <div className="lead-workbench">
      <section className="lead-queue" aria-label="线索队列">
        <div className="queue-toolbar">
          <div className="queue-search">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <span>搜索品牌、型号或卖家</span>
          </div>
          <div className="filter-tabs" role="group" aria-label="按状态与建议动作筛选">
            {(["all", "notify", "review", "skip", "pending", "filtered"] as const).map((value) => (
              <button
                className="filter-tab"
                data-active={filter === value}
                key={value}
                onClick={() => {
                  setFilter(value);
                  resetReviewState();
                }}
                type="button"
              >
                {filterLabels[value]}
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
                  resetReviewState();
                }}
                type="button"
              >
                <ListingPhoto src={item.listing.imageUrls[0]} alt="" category={item.listing.category} variant="thumb" />
                <span className="queue-item-main">
                  <span className="queue-item-topline">
                    <strong>{item.listing.brand} {item.listing.model}</strong>
                    <b>{item.assessment.filterCode || item.assessment.pending ? "—" : item.assessment.scores.totalOpportunity}</b>
                  </span>
                  <span className="queue-item-title">{item.listing.title}</span>
                  <span className="queue-item-meta">{currency.format(item.listing.price)} · {item.listing.region}</span>
                  <RiskChip level={item.assessment.riskLevel} />
                  {item.assessment.filterCode && <span className="seller-type-tag">已过滤</span>}
                  {item.assessment.pending && <span className="seller-type-tag">待模型评分</span>}
                  {item.listing.sellerExcluded && <span className="seller-type-tag">卖家已排除</span>}
                  {item.listing.handling === "ignored" && <span className="seller-type-tag">已忽略</span>}
                  {item.listing.handling === "pending" && <span className="seller-type-tag">待定</span>}
                  {nonPersonalSellerReason(item.listing.seller, sellerThresholds, item.listing.category) && <span className="seller-type-tag" title={nonPersonalSellerReason(item.listing.seller, sellerThresholds, item.listing.category) ?? undefined}>疑似非个人卖家</span>}
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
          <div className="lead-detail-actions">
            {listing.sourceUrl ? (
              <a className="button button-secondary" href={listing.sourceUrl} target="_blank" rel="noreferrer">
                打开原帖
                <ArrowSquareOut size={17} aria-hidden="true" />
              </a>
            ) : (
              <button className="button button-secondary" type="button" disabled title="当前记录没有原帖地址">
                打开原帖
                <ArrowSquareOut size={17} aria-hidden="true" />
              </button>
            )}
            {listing.handling === "ignored"
              ? <button className="button button-secondary" type="button" onClick={() => updateHandling("none")} disabled={blacklistBusy}>取消忽略</button>
              : <button className="button button-secondary" type="button" onClick={() => updateHandling("ignored")} disabled={blacklistBusy}>忽略商品</button>}
            {listing.handling !== "pending" && !listing.sellerExcluded && (
              <button className="button button-secondary" type="button" onClick={() => updateHandling("pending")} disabled={blacklistBusy}>暂时待定</button>
            )}
            {!listing.sellerExcluded && (
              <button className="button button-primary" type="button" onClick={() => setBlacklistOpen((open) => !open)} disabled={!listing.seller.sellerRecordId} title={listing.seller.sellerRecordId ? "拉黑后该卖家现有线索移出待处理，未来商品全部拦截" : "该线索缺少可定位的卖家记录"}>
                <Prohibit size={17} aria-hidden="true" />
                拉黑卖家
              </button>
            )}
          </div>
        </header>
        {blacklistOpen && (
          <div className="blacklist-form" role="form" aria-label="拉黑卖家">
            <div>
              <label>
                <span>拉黑原因</span>
                <select value={blacklistReason} onChange={(event) => setBlacklistReason(event.target.value as "manual-suspicion" | "merchant-name")}>
                  <option value="manual-suspicion">人工判断为商家</option>
                  <option value="merchant-name">卖家名称疑似商家</option>
                </select>
              </label>
              <label>
                <span>补充说明（可选）</span>
                <input value={blacklistNote} onChange={(event) => setBlacklistNote(event.target.value)} placeholder="例如：主页全是同款批发文案" maxLength={400} />
              </label>
            </div>
            <p className="blacklist-scope">
              将拉黑「{listing.seller.displayName} · {listing.region}」。当前多数卖家只有昵称+地区弱身份：同昵称同地区会一并拦截，卖家改名后需重新发现；匿名占位不能整组拉黑。操作会记录审计并可在排除管理撤销。
            </p>
            <div className="blacklist-form-actions">
              <button className="button button-primary button-small" type="button" onClick={submitBlacklist} disabled={blacklistBusy}>
                {blacklistBusy ? "处理中…" : "确认拉黑"}
              </button>
              <button className="button button-secondary button-small" type="button" onClick={() => setBlacklistOpen(false)} disabled={blacklistBusy}>取消</button>
            </div>
          </div>
        )}
        {actionNotice && <div className="feedback-notice" data-kind={actionNotice.kind} role="status">{actionNotice.text}</div>}
        {listing.sellerExcluded && (
          <div className="exclusion-banner" role="status">
            <Prohibit size={20} weight="fill" aria-hidden="true" />
            <div>
              <strong>卖家已被排除（{listing.sellerExcluded.source === "manual" ? "人工拉黑" : "规则自动排除"} · {exclusionReasonLabel(listing.sellerExcluded.reason)}）</strong>
              <p>匹配身份：{identityTypeLabel(listing.sellerExcluded.identityType)} · {listing.sellerExcluded.identityKey}。该卖家的商品不会再进入待处理；如需恢复请到排除管理撤销。</p>
            </div>
            <a className="button button-secondary button-small" href="/exclusions">前往排除管理</a>
          </div>
        )}
        {listing.handling === "ignored" && (
          <div className="exclusion-banner" role="status" data-kind="ignored">
            <Prohibit size={20} weight="fill" aria-hidden="true" />
            <div>
              <strong>该商品已被忽略</strong>
              <p>不再进入待处理队列；同一卖家的新商品不受影响。</p>
            </div>
          </div>
        )}

        <div className="lead-facts">
          <div><span>挂牌价</span><strong>{currency.format(listing.price)}</strong></div>
          <div><span>市场参考价</span><strong>{listing.marketReferencePrice ? currency.format(listing.marketReferencePrice) : "暂无合格参考价"}</strong>{listing.marketReferenceVersion && <small>人工复核 v{listing.marketReferenceVersion} · <a href={listing.marketReferenceId ? `/knowledge#price-reference-${listing.marketReferenceId}` : "/knowledge"}>查看来源</a></small>}</div>
          <div><span>区域 / 距离</span><strong>{listing.region}{listing.distanceKm ? ` · ${listing.distanceKm}km` : ""}</strong></div>
          <div>
            <span>卖家</span>
            <strong>{listing.seller.displayName} · 已采集在架 {listing.seller.activeListingCount} 条</strong>
            {listing.sellerObservedItemCount !== undefined && (
              <small className="seller-observed-types">搜索列表跨轮累计发现 {listing.sellerObservedItemCount} 件不同商品（观察口径，非平台在售总数）。</small>
            )}
            {listing.seller.signalScope === "complete-profile" ? (
              <small className="seller-observed-types">
                主页统计：已卖出 {listing.seller.completedSaleCount ?? "未知"} 件 · 在售 {listing.seller.onSaleCount ?? "未知"} 件{listing.seller.creditLevel ? ` · 信用 ${listing.seller.creditLevel}` : ""}{listing.seller.accountAgeDays !== undefined ? ` · 来闲鱼约 ${Math.max(1, Math.floor(listing.seller.accountAgeDays / 365))} 年` : ""}
              </small>
            ) : (
              <small className="seller-observed-types">
                已采集在架品类：{(["watch", "bag", "jewelry", "other"] as const).map((category) => `${categoryLabels[category]} ${listing.seller.observedCategoryCounts?.[category] ?? (category === listing.category ? listing.seller.sameCategoryCount ?? 0 : 0)} 条`).join(" · ")}
              </small>
            )}
            {completeProfile && profileMixText && <small className="seller-observed-types">主页在售分类：{profileMixText}</small>}
            <small className="seller-observed-types">
              {completeProfile ? "统计来自卖家主页的近期只读抓取，用于职业卖家判定" : `尚未取得卖家主页商品分布；当前仅有已入库的同品类 ${listing.seller.sameCategoryCount ?? 0} 条，不能据此确认卖家类型（规则阈值 ${sellerThresholds.sameCategoryMinCount} 条）。`}
            </small>
            {sellerTypeReason && <em className="seller-type-tag" title={sellerTypeReason}>疑似非个人卖家</em>}
          </div>
        </div>

        <div className="listing-photo-list" data-demo-mode={demoMode} aria-label="商品图片横向列表">
          <button className="listing-photo-list-arrow" type="button" onClick={() => movePhoto(-1)} disabled={photos.length < 2} aria-label="向左切换商品图片"><CaretLeft size={22} weight="bold" /></button>
          <div className="listing-photo-list-viewport">
            <div className="listing-photo-list-track">
              {visiblePhotos.length > 0 ? visiblePhotos.map((src, offset) => {
                const index = photoWindowStart + offset;
                return (
                  <button className="listing-photo-item" data-active={selectedPhotoIndex === index} key={`${src}-${index}`} type="button" onClick={() => { setPhotoIndex(index); setLightboxOpen(true); }} aria-label={`放大查看第 ${index + 1} 张商品图片`}>
                    <ListingPhoto src={src} alt={`${listing.brand}商品图片 ${index + 1}`} category={listing.category} variant="card" />
                    <span>{index + 1}</span>
                  </button>
                );
              }) : (
                <ListingPhoto alt="暂无商品图片" category={listing.category} variant="card" />
              )}
            </div>
          </div>
          <button className="listing-photo-list-arrow" type="button" onClick={() => movePhoto(1)} disabled={photos.length < 2} aria-label="向右切换商品图片"><CaretRight size={22} weight="bold" /></button>
          <span className="listing-photo-list-count">{photos.length > 0 ? `${selectedPhotoIndex + 1} / ${photos.length}` : "暂无图片"}</span>
        </div>

        {lightboxOpen && activePhoto && (
          <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="商品图片预览" onClick={() => setLightboxOpen(false)}>
            <div className="photo-lightbox-content" onClick={(event) => event.stopPropagation()}>
              <button className="photo-lightbox-close" type="button" onClick={() => setLightboxOpen(false)} aria-label="关闭图片预览"><X size={22} /></button>
              {photos.length > 1 && <button className="photo-lightbox-arrow photo-lightbox-arrow-left" type="button" onClick={() => movePhoto(-1)} aria-label="上一张图片"><CaretLeft size={27} weight="bold" /></button>}
              <ListingPhoto src={activePhoto} alt={`${listing.brand}商品图片 ${selectedPhotoIndex + 1}`} category={listing.category} variant="lightbox" />
              {photos.length > 1 && <button className="photo-lightbox-arrow photo-lightbox-arrow-right" type="button" onClick={() => movePhoto(1)} aria-label="下一张图片"><CaretRight size={27} weight="bold" /></button>}
              <span className="photo-lightbox-count">{selectedPhotoIndex + 1} / {photos.length}</span>
            </div>
          </div>
        )}

        <div className="assessment-summary">
          <div className="opportunity-score">
            <span>综合机会分</span>
            <strong>{assessment.pending ? "—" : assessment.scores.totalOpportunity}</strong>
            <small>/ 100</small>
          </div>
          <div className="assessment-copy">
            <RiskChip level={assessment.riskLevel} />
            {assessment.filterCode && <span className="seller-type-tag">前置过滤</span>}
            {assessment.pending && <span className="seller-type-tag">待模型评分</span>}
            <h3>{actionLabels[assessment.recommendedAction]}</h3>
            <p>{assessment.summary}</p>
            <small>
              {assessment.pending
                ? assessment.pendingReason === "price-reference-changed" ? "参考价已变化，旧评分暂停使用；请手动重评或等待下一次扫描。" : "JEV 评分暂不可用（未配置、总开关关闭或评分失败）；线索已保留，评分恢复后自动补评。"
                : assessment.filterCode
                  ? "该线索由前置过滤器拦截，未调用 JEV 评分。"
                  : assessment.modelVersion
                    ? `JEV 主评分 ${assessment.modelVersion}`
                    : "暂无模型评分记录"}
              {assessment.modelConfidence !== undefined ? ` · 模型置信度 ${assessment.modelConfidence}%` : ""}
              {assessment.modelConfidence !== undefined && assessment.modelConfidence < confidenceThreshold ? " · 建议人工复核" : ""}
            </small>
          </div>
        </div>

        <div className="score-grid" aria-label="分项评分">
          <div><span>个人卖家概率</span><strong>{assessment.pending ? "—" : assessment.scores.personalSeller}</strong><small>账号与文案</small></div>
          <div><span>疑假风险</span><strong>{assessment.pending ? "—" : assessment.scores.authenticityRisk}</strong><small>越高风险越大</small></div>
          <div><span>信息充分度</span><strong>{assessment.pending ? "—" : assessment.scores.informationCompleteness}</strong><small>图片与来源</small></div>
          <div><span>利润机会</span><strong>{assessment.pending ? "—" : assessment.scores.profitOpportunity}</strong><small>仅作初筛参考</small></div>
        </div>

        <div className="detail-columns">
          <section className="evidence-section">
            <div className="section-heading compact-heading">
              <div>
                <h3>判断依据</h3>
                <p>按影响程度排序，结论可被人工纠正。</p>
              </div>
              <span>{assessment.pending ? "评分待补" : assessment.filterCode ? "前置过滤" : assessment.modelVersion ? `JEV 主评分 ${assessment.modelVersion}` : `版本 ${assessment.rulesetVersion}`}</span>
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
                      <small>来源：{evidenceSourceLabels[item.source] ?? item.source} · {item.scoreImpact === 0 ? "参考信号" : `影响 ${item.scoreImpact > 0 ? "+" : ""}${item.scoreImpact}`}</small>
                      {item.source === "model" && item.probabilities && (
                        <small>概率：{Object.entries(item.probabilities).map(([key, value]) => `${key} ${Math.round(value * 100)}%`).join(" · ")}</small>
                      )}
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
              {Boolean(assessment.knowledgeQuestions?.length) && <div className="knowledge-questions"><h4>当前知识追问</h4><ul>{assessment.knowledgeQuestions!.map((question) => <li key={question}>{question}</li>)}</ul><small>来自目前已批准知识，供人工沟通参考；不代表本次评估时已使用。</small></div>}
            </div>

            <div className="review-block">
              <h3><UserCircleCheck size={19} aria-hidden="true" /> 人工反馈</h3>
              <p>直接写下证据、纠正意见或规则条件，提交后会保存在当前线索的反馈记录中。</p>
              <div className="feedback-form">
                <label>
                  <span>提交类型</span>
                  <select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value as "manual-feedback" | "rule-candidate")}>
                    <option value="manual-feedback">人工意见</option>
                    <option value="rule-candidate">规则候选</option>
                  </select>
                </label>
                <label>
                  <span>结论标签（可选）</span>
                  <input value={feedbackLabel} onChange={(event) => setFeedbackLabel(event.target.value)} placeholder="例如：补充序列号后可收" maxLength={80} />
                </label>
                <label>
                  <span>意见或规则内容</span>
                  <textarea value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="写下你看到的证据、需要纠正的判断，或下一版规则应满足的条件…" rows={4} maxLength={4000} />
                </label>
                <button className="button button-primary button-small" type="button" onClick={submitFeedback} disabled={feedbackSubmitting || !feedbackText.trim()}>
                  {feedbackSubmitting ? "保存中…" : feedbackType === "rule-candidate" ? "提交规则候选" : "提交人工反馈"}
                </button>
              </div>
              {feedbackNotice && (
                <div className="feedback-notice" data-kind={feedbackNotice.kind}>
                  {feedbackNotice.text}
                </div>
              )}
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
