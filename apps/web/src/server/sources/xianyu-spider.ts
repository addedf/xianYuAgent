import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketplaceListing } from "@/src/domain/listing";
import type { ServerEnv } from "@/src/server/env";
import { getXianyuAuthStatus } from "./xianyu-auth";
import { requestXianyuCollector } from "./xianyu-collector-client";

export { validateLocalCollectorUrl } from "./xianyu-collector-client";

export const xianyuSearchInputSchema = z
  .object({
    keyword: z.string().trim().min(1).max(40),
    category: z.enum(["watch", "bag", "jewelry"]),
    maxPages: z.number().int().min(1).max(3).default(1),
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
});

const sourceProductSchema = z.object({
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  price: z.string(),
  area: z.string().nullish().transform((value) => value?.trim() || "地区未知"),
  seller: z.string().nullish().transform((value) => value?.trim() || "匿名卖家"),
  link: z.string().nullish().transform((value) => value?.trim() || ""),
  image_url: z.string().nullish().transform((value) => value?.trim() || ""),
  publish_time: z.union([z.date(), z.string(), z.null()]),
});

export type SourceProduct = z.infer<typeof sourceProductSchema>;
type CollectorResponse = z.infer<typeof collectorResponseSchema>;

export interface XianyuImportResult {
  keyword: string;
  loggedIn: boolean;
  totalResults: number;
  newRecords: number;
  importedRecords: number;
  skippedRecords: number;
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
  persistListings?: (listings: MarketplaceListing[], products: SourceProduct[]) => Promise<number>;
}

const BRAND_ALIASES: Array<{ brand: string; terms: string[] }> = [
  { brand: "劳力士", terms: ["劳力士", "rolex"] },
  { brand: "欧米茄", terms: ["欧米茄", "omega"] },
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

function parsePrice(value: string): number | null {
  const normalized = value.replace(/[¥￥,\s]|当前价/g, "").toLowerCase();
  const multiplier = normalized.includes("万") ? 10_000 : 1;
  const numeric = Number.parseFloat(normalized.replace("万", ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * multiplier * 100) / 100;
}

function inferBrand(title: string, keyword: string): string {
  const haystack = `${title} ${keyword}`.toLowerCase();
  return BRAND_ALIASES.find(({ terms }) => terms.some((term) => haystack.includes(term.toLowerCase())))?.brand ?? keyword;
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

export function normalizeXianyuProduct(productValue: unknown, input: XianyuSearchInput): MarketplaceListing | null {
  const product = sourceProductSchema.parse(productValue);
  const price = parsePrice(product.price);
  if (price === null) return null;

  const now = new Date();
  const publishDate = product.publish_time ? new Date(product.publish_time) : null;
  const publishedAt = publishDate && Number.isFinite(publishDate.getTime()) ? publishDate.toISOString() : new Date(0).toISOString();
  const sourceUrl = safeHttpUrl(product.link.replace("fleamarket://", "https://www.goofish.com/"));
  const imageUrl = safeHttpUrl(product.image_url);
  const sellerExternalId = `nickname-${hash(`${product.seller}|${product.area}`, 20)}`;

  return {
    id: `xianyu-${xianyuProductExternalId(product.link, product.id)}`,
    externalId: xianyuProductExternalId(product.link, product.id),
    platform: "xianyu",
    category: input.category,
    brand: inferBrand(product.title, input.keyword),
    title: product.title,
    description: "",
    price,
    region: product.area,
    publishedAt,
    firstSeenAt: now.toISOString(),
    imageUrls: imageUrl ? [imageUrl] : [],
    duplicateImageCount: 0,
    hasSerialDetail: false,
    hasPurchaseProof: false,
    hasAccessoryDescription: false,
    monitorKeywords: [input.keyword],
    sourceUrl,
    seller: {
      externalId: sellerExternalId,
      displayName: product.seller,
      region: product.area,
      activeListingCount: 6,
      sameCategoryRatio: 0,
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
  }, { env, fetcher });
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
  const importedRecords = await persistListings(normalized, products);

  return {
    keyword: input.keyword,
    loggedIn: collectorResult.logged_in,
    totalResults: collectorResult.total_results,
    newRecords: collectorResult.new_records,
    importedRecords,
    skippedRecords: Math.max(0, products.length - normalized.length),
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
