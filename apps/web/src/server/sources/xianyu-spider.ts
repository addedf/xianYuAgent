import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketplaceListing } from "@/src/domain/listing";
import type { ServerEnv } from "@/src/server/env";

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

export function validateLocalCollectorUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("闲鱼采集器地址不是有效 URL。");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!localHosts.has(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("闲鱼采集器只允许连接本机回环地址，且地址中不能包含账号密码。");
  }
  return url;
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
  collectorUrl: string,
  input: XianyuSearchInput,
  fetcher: typeof fetch,
): Promise<CollectorResponse> {
  const baseUrl = validateLocalCollectorUrl(collectorUrl);
  const response = await fetcher(new URL("/search/", baseUrl), {
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
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("本地闲鱼采集器搜索失败，请检查登录态和采集器终端输出。");
  const parsed = collectorResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("本地闲鱼采集器返回了无法识别的响应。");
  return parsed.data;
}

export async function importXianyuSearch(inputValue: unknown, dependencies: ImportDependencies = {}): Promise<XianyuImportResult> {
  const input = xianyuSearchInputSchema.parse(inputValue);
  const env = dependencies.env ?? (await import("@/src/server/env")).getServerEnv();
  if (env.XIANYU_COLLECTOR_ENABLED !== "true") throw new Error("闲鱼只读采集器尚未启用。");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL 尚未配置，不能导入真实商品。");

  const collectorResult = await requestCollector(env.XIANYU_COLLECTOR_URL, input, dependencies.fetcher ?? fetch);
  const productDatabaseUrl = env.XIANYU_COLLECTOR_DATABASE_URL || env.DATABASE_URL;
  const loadProducts = dependencies.loadProducts ?? (await import("./xianyu-spider-persistence")).loadSourceProducts;
  const products = await loadProducts(collectorResult.new_record_ids, productDatabaseUrl);
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
  };
}
