import { createHash } from "node:crypto";
import { z } from "zod";
import { containsAny, PURCHASE_PROOF_TERMS, SERIAL_TERMS, ACCESSORY_TERMS } from "@/src/domain/facts";
import type { Category, MarketplaceListing } from "@/src/domain/listing";
import type { ServerEnv } from "@/src/server/env";
import type { SaveListingsOutcome } from "./xianyu-spider-persistence";
import { getXianyuAuthStatus } from "./xianyu-auth";
import { requestXianyuCollector } from "./xianyu-collector-client";

export { validateLocalCollectorUrl } from "./xianyu-collector-client";

export const xianyuSearchInputSchema = z
  .object({
    keyword: z.string().trim().min(1).max(40),
    maxPages: z.number().int().min(1).max(10).default(1),
    minPrice: z.number().int().nonnegative().optional(),
    maxPrice: z.number().int().positive().optional(),
    province: z.string().trim().max(20).optional(),
    city: z.string().trim().max(20).optional(),
    publishDays: z.number().int().min(1).max(30).optional(),
  })
  .refine((value) => value.maxPrice === undefined || value.minPrice === undefined || value.maxPrice >= value.minPrice, {
    message: "最高价不能低于最低价。",
    path: ["maxPrice"],
  });

export type XianyuSearchInput = z.infer<typeof xianyuSearchInputSchema>;

const collectorResponseSchema = z.object({
  status: z.literal("success"),
  keyword: z.string(),
  logged_in: z.boolean(),
  user_id: z.string().optional().default(""),
  total_results: z.number().int().nonnegative(),
  new_records: z.number().int().nonnegative(),
  new_record_ids: z.array(z.number().int().positive()),
  record_ids: z.array(z.number().int().positive()).optional(),
  enriched_details: z.number().int().nonnegative().optional(),
  blocked_details: z.number().int().nonnegative().optional(),
  seller_profiles: z.object({
    fetched: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cooldown: z.number().int().nonnegative(),
  }).optional(),
});

const sourceProductSchema = z.object({
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  price: z.string(),
  area: z.string().nullish().transform((value) => value?.trim() || "地区未知"),
  seller: z.string().nullish().transform((value) => value?.trim() || "匿名卖家"),
  link: z.string().nullish().transform((value) => value?.trim() || ""),
  image_url: z.string().nullish().transform((value) => value?.trim() || ""),
  image_urls: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  publish_time: z.union([z.date(), z.string(), z.null()]),
  detail_json: z.string().nullish(),
  seller_user_id: z.string().nullish(),
  seller_profile_json: z.string().nullish(),
});

export type SourceProduct = z.infer<typeof sourceProductSchema>;
type CollectorResponse = z.infer<typeof collectorResponseSchema>;

export interface DetailSnapshot {
  description: string;
  attributes: Array<{ name: string; value: string }>;
  soldCount?: number;
  wantCount?: number;
  viewCount?: number;
  sellerUserId?: string;
  sellerSoldCount?: number;
}

export interface SellerProfileSnapshot {
  nickName?: string;
  soldCount?: number;
  onSaleCount?: number;
  creditLevel?: string;
  registrationRaw?: string;
  sampledCount?: number;
  categoryCounts?: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findScalar(value: unknown, names: string[], depth = 4): string | number | null {
  if (depth < 0 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findScalar(entry, names, depth - 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const name of names) {
    const entry = value[name];
    if (typeof entry === "string" || typeof entry === "number") return entry;
  }
  for (const entry of Object.values(value)) {
    const found = findScalar(entry, names, depth - 1);
    if (found !== null) return found;
  }
  return null;
}

// 详情/主页原始 JSON 由采集器存档，这里防御式解析；线上字段名变化时只改解析函数。
export function parseDetailSnapshot(detailJson: string | null | undefined): DetailSnapshot | null {
  if (!detailJson) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(detailJson);
  } catch {
    return null;
  }
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
  const itemDO = data && isRecord(data.itemDO) ? data.itemDO : undefined;
  if (!isRecord(itemDO)) return null;
  const sellerDO = data && isRecord(data.sellerDO) ? data.sellerDO : undefined;
  const attributes: DetailSnapshot["attributes"] = [];
  for (const key of ["attributeList", "attributes", "itemAttributes", "propList"]) {
    const container = itemDO[key];
    if (!Array.isArray(container)) continue;
    for (const entry of container) {
      if (!isRecord(entry)) continue;
      const name = entry.name ?? entry.propertyName ?? entry.attrName;
      const value = entry.value ?? entry.valueText ?? entry.attrValue;
      if (typeof name === "string" && name.trim() && typeof value === "string" && value.trim()) {
        attributes.push({ name: name.trim(), value: value.trim() });
      }
    }
  }
  const description = typeof itemDO.desc === "string" && itemDO.desc.trim()
    ? itemDO.desc.trim()
    : typeof itemDO.description === "string" ? itemDO.description.trim() : "";
  const snapshot: DetailSnapshot = { description, attributes };
  const soldCount = findScalar(itemDO, ["soldCount", "soldCnt", "soldItemCount", "soldNum"], 2);
  if (typeof soldCount === "number") snapshot.soldCount = soldCount;
  const wantCount = findScalar(itemDO, ["wantCount", "wantNum", "desireCount"], 2);
  if (typeof wantCount === "number") snapshot.wantCount = wantCount;
  const viewCount = findScalar(itemDO, ["viewCount", "viewNum", "browseCount"], 2);
  if (typeof viewCount === "number") snapshot.viewCount = viewCount;
  const sellerUserId = findScalar(itemDO, ["userId", "sellerId", "sellerUserId", "ownerUserId"], 3);
  if (sellerUserId !== null && sellerUserId !== "") snapshot.sellerUserId = String(sellerUserId);
  // 详情页卖家卡片的「已卖出 N 件」，平台公开展示，视作已核验的卖家成交量。
  if (sellerDO) {
    const sellerSoldCount = findScalar(sellerDO, ["hasSoldNumInteger", "soldNum", "soldCount"], 2);
    if (typeof sellerSoldCount === "number" && Number.isSafeInteger(sellerSoldCount) && sellerSoldCount >= 0) {
      snapshot.sellerSoldCount = sellerSoldCount;
    }
  }
  return snapshot;
}

export function parseSellerProfileSnapshot(profileJson: string | null | undefined): SellerProfileSnapshot | null {
  if (!profileJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(profileJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const snapshot: SellerProfileSnapshot = {};
  if (typeof parsed.nickName === "string" && parsed.nickName.trim()) snapshot.nickName = parsed.nickName.trim();
  if (typeof parsed.soldCount === "number" && Number.isSafeInteger(parsed.soldCount) && parsed.soldCount >= 0) snapshot.soldCount = parsed.soldCount;
  if (typeof parsed.onSaleCount === "number" && Number.isSafeInteger(parsed.onSaleCount) && parsed.onSaleCount >= 0) snapshot.onSaleCount = parsed.onSaleCount;
  if (typeof parsed.creditLevel === "string" && parsed.creditLevel.trim()) snapshot.creditLevel = parsed.creditLevel.trim();
  if (typeof parsed.registrationRaw === "string" && parsed.registrationRaw.trim()) snapshot.registrationRaw = parsed.registrationRaw.trim();
  if (typeof parsed.sampledCount === "number" && Number.isSafeInteger(parsed.sampledCount) && parsed.sampledCount >= 0) snapshot.sampledCount = parsed.sampledCount;
  if (isRecord(parsed.categoryCounts)) {
    const categoryCounts: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.categoryCounts)) {
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) categoryCounts[key] = value;
    }
    if (Object.keys(categoryCounts).length > 0) snapshot.categoryCounts = categoryCounts;
  }
  return snapshot;
}

export function accountAgeDaysFromRegistration(raw: string | undefined, now: Date): number | undefined {
  if (!raw) return undefined;
  const yearsMatch = raw.match(/(\d+)\s*年/);
  if (yearsMatch) return Number.parseInt(yearsMatch[1], 10) * 365;
  const epochMs = Number.parseFloat(raw);
  if (Number.isFinite(epochMs) && epochMs > 1_000_000_000_000) {
    return Math.max(0, Math.round((now.getTime() - epochMs) / 86_400_000));
  }
  const parsedDate = Date.parse(raw);
  if (Number.isFinite(parsedDate)) return Math.max(0, Math.round((now.getTime() - parsedDate) / 86_400_000));
  return undefined;
}

interface DetailDerivedFacts {
  hasSerialDetail: boolean;
  hasPurchaseProof: boolean;
  hasAccessoryDescription: boolean;
  brand?: string;
  model?: string;
}

export function deriveFactsFromDetail(snapshot: DetailSnapshot | null): DetailDerivedFacts {
  if (!snapshot) return { hasSerialDetail: false, hasPurchaseProof: false, hasAccessoryDescription: false };
  const attributeText = snapshot.attributes.map(({ name, value }) => `${name}${value}`).join(" ");
  const haystack = `${snapshot.description} ${attributeText}`;
  const brandAttribute = snapshot.attributes.find(({ name }) => /品牌/.test(name))?.value;
  const modelAttribute = snapshot.attributes.find(({ name }) => /系列|型号|款式/.test(name))?.value;
  return {
    hasSerialDetail: containsAny(haystack, SERIAL_TERMS).length > 0,
    hasPurchaseProof: containsAny(haystack, PURCHASE_PROOF_TERMS).length > 0,
    hasAccessoryDescription: containsAny(haystack, ACCESSORY_TERMS).length > 0,
    ...(brandAttribute?.split(/[\/／]/, 1)[0].trim() ? { brand: brandAttribute.split(/[\/／]/, 1)[0].trim() } : {}),
    ...(modelAttribute?.trim() ? { model: modelAttribute.trim() } : {}),
  };
}

export interface XianyuImportResult {
  keyword: string;
  loggedIn: boolean;
  totalResults: number;
  newRecords: number;
  importedRecords: number;
  filteredRecords: number;
  pendingEvaluation: number;
  skippedRecords: number;
  /** 本轮补抓到详情的商品数（含图片之外的字段）。 */
  enrichedDetails?: number;
  /** 本轮详情被平台限流的商品数。 */
  blockedDetails?: number;
  /** 本轮卖家主页抓取的审计计数。 */
  sellerProfiles?: CollectorResponse["seller_profiles"];
  items: XianyuImportedItem[];
}

export interface XianyuImportedItem {
  externalId: string;
  title: string;
  price: number;
  region: string;
  publishedAt: string;
  sourceUrl?: string;
  imageUrl?: string;
}

interface ImportDependencies {
  env?: ServerEnv;
  fetcher?: typeof fetch;
  loadProducts?: (ids: number[], databaseUrl: string) => Promise<SourceProduct[]>;
  persistListings?: (listings: MarketplaceListing[], products: SourceProduct[], scanScope: string) => Promise<SaveListingsOutcome>;
}

const BRAND_ALIASES: Array<{ brand: string; terms: string[] }> = [
  { brand: "劳力士", terms: ["劳力士", "rolex"] },
  { brand: "欧米茄", terms: ["欧米茄", "omega"] },
  { brand: "浪琴", terms: ["浪琴", "longines"] },
  { brand: "卡地亚", terms: ["卡地亚", "cartier"] },
  { brand: "Louis Vuitton", terms: ["louis vuitton", "lv", "路易威登"] },
  { brand: "Chanel", terms: ["chanel", "香奈儿"] },
  { brand: "Hermès", terms: ["hermès", "hermes", "爱马仕"] },
  { brand: "Gucci", terms: ["gucci", "古驰"] },
  { brand: "Bvlgari", terms: ["bvlgari", "宝格丽"] },
];

function hash(value: string, length = 32): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function xianyuScanScope(input: XianyuSearchInput): string {
  return hash(JSON.stringify({
    keyword: input.keyword,
    province: input.province ?? "",
    city: input.city ?? "",
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    maxPages: input.maxPages,
    publishDays: input.publishDays ?? null,
  }));
}

function parsePrice(value: string): number | null {
  const normalized = value.replace(/[¥￥,\s]|当前价/g, "").toLowerCase();
  const multiplier = normalized.includes("万") ? 10_000 : 1;
  const numeric = Number.parseFloat(normalized.replace("万", ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * multiplier * 100) / 100;
}

function inferBrand(title: string, keyword: string): string {
  const haystack = `${title} ${keyword}`.toLowerCase();
  return BRAND_ALIASES.find(({ terms }) => terms.some((term) => haystack.includes(term.toLowerCase())))?.brand ?? "待识别品牌";
}

export function inferListingCategory(title: string, description: string, keyword: string): Category {
  // 先看商品本身，再用搜索词兜底；品牌词单独出现时不推断品类。
  const patterns: Array<[Category, RegExp]> = [
    ["watch", /腕表|手表|机械表|石英表|表盘|表带|日志型|潜航者|海马|\b(?:watch|rolex|omega)\b/],
    ["bag", /箱包|手袋|背包|单肩包|斜挎包|托特包|水桶包|旅行包|钱包|卡包|发财桶|\b(?:bag|purse|tote)\b/],
    ["jewelry", /首饰|珠宝|项链|手链|戒指|耳环|耳钉|吊坠|手镯|胸针|珠串|\b(?:jewelry|necklace|ring)\b/],
  ];
  const classify = (value: string) => patterns.find(([, pattern]) => pattern.test(value.toLowerCase()))?.[0];
  return classify(title)
    ?? classify(description)
    ?? classify(keyword)
    ?? "other";
}

/** 旧版“昵称+地区”卖家键；稳定 ID 首次出现时按它把旧行原位改名，避免身份分裂。 */
export function legacySellerExternalId(displayName: string, region: string): string {
  return `nickname-${hash(`${displayName}|${region}`, 20)}`;
}

export function xianyuProductExternalId(link: string, sourceId: number): string {
  try {
    const normalized = link.replace("fleamarket://", "https://www.goofish.com/");
    const url = new URL(normalized);
    const fromQuery = url.searchParams.get("id") ?? url.searchParams.get("itemId");
    if (fromQuery) return fromQuery;
    const fromPath = url.pathname.match(/(?:item|goods)\/(\w+)/i)?.[1];
    if (fromPath) return fromPath;
  } catch {
    // 部分历史链接不是标准 URL，使用稳定哈希兜底。
  }
  return `source-${sourceId}-${hash(link || String(sourceId), 16)}`;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseImageUrls(product: SourceProduct): string[] {
  const values = Array.isArray(product.image_urls)
    ? product.image_urls
    : typeof product.image_urls === "string"
      ? (() => {
        try {
          const parsed = JSON.parse(product.image_urls);
          return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [product.image_urls];
        } catch {
          return [product.image_urls];
        }
      })()
      : [];
  return [...new Set([product.image_url, ...values].map(safeHttpUrl).filter((value): value is string => Boolean(value)))];
}

export function normalizeXianyuProduct(productValue: unknown, input: XianyuSearchInput): MarketplaceListing | null {
  const product = sourceProductSchema.parse(productValue);
  const price = parsePrice(product.price);
  if (price === null) return null;

  const now = new Date();
  const publishDate = product.publish_time ? new Date(product.publish_time) : null;
  const publishedAt = publishDate && Number.isFinite(publishDate.getTime()) ? publishDate.toISOString() : new Date(0).toISOString();
  const sourceUrl = safeHttpUrl(product.link.replace("fleamarket://", "https://www.goofish.com/"));
  const imageUrls = parseImageUrls(product);
  const detail = parseDetailSnapshot(product.detail_json);
  const detailFacts = deriveFactsFromDetail(detail);
  const sellerProfile = parseSellerProfileSnapshot(product.seller_profile_json);
  const detailSellerUserId = product.seller_user_id?.trim() || detail?.sellerUserId || "";
  const stableSellerId = detailSellerUserId ? `xianyu-user-${detailSellerUserId}` : "";

  return {
    id: `xianyu-${xianyuProductExternalId(product.link, product.id)}`,
    externalId: xianyuProductExternalId(product.link, product.id),
    platform: "xianyu",
    category: inferListingCategory(product.title, detail?.description ?? "", input.keyword),
    brand: detailFacts.brand ?? inferBrand(product.title, input.keyword),
    model: detailFacts.model,
    title: product.title,
    description: detail?.description ?? "",
    price,
    region: product.area,
    publishedAt,
    firstSeenAt: now.toISOString(),
    imageUrls,
    duplicateImageCount: 0,
    hasSerialDetail: detailFacts.hasSerialDetail,
    hasPurchaseProof: detailFacts.hasPurchaseProof,
    hasAccessoryDescription: detailFacts.hasAccessoryDescription,
    monitorKeywords: [input.keyword],
    sourceUrl,
    seller: {
      externalId: stableSellerId || legacySellerExternalId(product.seller, product.area),
      displayName: product.seller,
      region: product.area,
      activeListingCount: 0,
      sameCategoryRatio: 0,
      ...(sellerProfile?.soldCount !== undefined
        ? { completedSaleCount: sellerProfile.soldCount, completedSaleCountVerified: true }
        : detail?.sellerSoldCount !== undefined
          ? { completedSaleCount: detail.sellerSoldCount, completedSaleCountVerified: true }
          : {}),
      ...(sellerProfile?.onSaleCount !== undefined ? { onSaleCount: sellerProfile.onSaleCount } : {}),
      ...(sellerProfile?.categoryCounts ? { profileCategoryMix: sellerProfile.categoryCounts } : {}),
      ...(sellerProfile?.creditLevel ? { creditLevel: sellerProfile.creditLevel } : {}),
      ...(sellerProfile?.registrationRaw
        ? { accountAgeDays: accountAgeDaysFromRegistration(sellerProfile.registrationRaw, now) }
        : {}),
      identityScope: stableSellerId ? "stable-platform-id" : "nickname-region",
      templateSimilarity: 0,
      hasPersonalStorySignals: false,
      hasNaturalSceneSignals: false,
    },
  };
}

export function parseSourceProduct(value: unknown): SourceProduct {
  return sourceProductSchema.parse(value);
}

async function requestCollector(
  env: ServerEnv,
  input: XianyuSearchInput,
  fetcher: typeof fetch,
): Promise<CollectorResponse> {
  // 详情与主页补抓在采集器内串行 + 抖动，一轮完整搜索可能超过两分钟，
  // 超时太短会导致采集器已成功入库而 Web 端先报错。
  const payload = await requestXianyuCollector("/search/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keyword: input.keyword,
      max_pages: input.maxPages,
      sort: "newest",
      min_price: input.minPrice,
      max_price: input.maxPrice,
      province: input.province,
      city: input.city,
      publish_days: input.publishDays,
    }),
  }, { env, fetcher, timeoutMs: 300_000 });
  const parsed = collectorResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("本地闲鱼采集器返回了无法识别的响应。");
  return parsed.data;
}

export async function importXianyuSearch(inputValue: unknown, dependencies: ImportDependencies = {}): Promise<XianyuImportResult> {
  const input = xianyuSearchInputSchema.parse(inputValue);
  const env = dependencies.env ?? (await import("@/src/server/env")).getServerEnv();
  if (env.XIANYU_COLLECTOR_ENABLED !== "true") throw new Error("闲鱼只读采集器尚未启用。");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL 尚未配置，不能导入真实商品。");

  const fetcher = dependencies.fetcher ?? fetch;
  const auth = await getXianyuAuthStatus({ env, fetcher });
  if (!auth.loggedIn) throw new Error("请先在连接与控制页面完成闲鱼账号登录。");

  const collectorResult = await requestCollector(env, input, fetcher);
  if (!collectorResult.logged_in) throw new Error("闲鱼登录态已失效，请重新连接账号。");
  const productDatabaseUrl = env.XIANYU_COLLECTOR_DATABASE_URL || env.DATABASE_URL;
  const loadProducts = dependencies.loadProducts ?? (await import("./xianyu-spider-persistence")).loadSourceProducts;
  const resultIds = collectorResult.record_ids?.length ? collectorResult.record_ids : collectorResult.new_record_ids;
  const products = await loadProducts(resultIds, productDatabaseUrl);
  const normalized = products
    .map((product) => normalizeXianyuProduct(product, input))
    .filter((listing): listing is MarketplaceListing => listing !== null);
  const persistListings = dependencies.persistListings ?? (await import("./xianyu-spider-persistence")).saveListings;
  const { imported: importedRecords, filtered: filteredRecords, pendingEvaluation } = await persistListings(normalized, products, xianyuScanScope(input));

  return {
    keyword: input.keyword,
    loggedIn: collectorResult.logged_in,
    totalResults: collectorResult.total_results,
    newRecords: collectorResult.new_records,
    importedRecords,
    filteredRecords,
    pendingEvaluation,
    skippedRecords: Math.max(0, products.length - normalized.length),
    ...(collectorResult.enriched_details !== undefined ? { enrichedDetails: collectorResult.enriched_details } : {}),
    ...(collectorResult.blocked_details !== undefined ? { blockedDetails: collectorResult.blocked_details } : {}),
    ...(collectorResult.seller_profiles ? { sellerProfiles: collectorResult.seller_profiles } : {}),
    items: normalized.slice(0, 20).map((listing) => ({
      externalId: listing.externalId,
      title: listing.title,
      price: listing.price,
      region: listing.region,
      publishedAt: listing.publishedAt,
      sourceUrl: listing.sourceUrl,
      imageUrl: listing.imageUrls[0],
    })),
  };
}
