import { describe, expect, it, vi } from "vitest";
import { getServerEnv, type ServerEnv } from "@/src/server/env";
import {
  accountAgeDaysFromRegistration,
  importXianyuSearch,
  inferListingCategory,
  legacySellerExternalId,
  normalizeXianyuProduct,
  parseDetailSnapshot,
  parseSellerProfileSnapshot,
  validateLocalCollectorUrl,
  xianyuScanScope,
} from "./xianyu-spider";

const env: ServerEnv = {
  ...getServerEnv({ NODE_ENV: "test" }),
  APP_DEMO_MODE: "false",
  DATABASE_URL: "postgresql://placeholder/agent",
  REDIS_URL: "",
  WECOM_WEBHOOK_URL: "",
  ADMIN_PASSWORD: "a-long-local-password",
  ADMIN_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  XIANYU_COLLECTOR_ENABLED: "true",
  XIANYU_COLLECTOR_URL: "http://127.0.0.1:8000",
  XIANYU_COLLECTOR_API_TOKEN: "collector-token",
  XIANYU_COLLECTOR_DATABASE_URL: "postgresql://placeholder/collector",
  OUTBOUND_MESSAGING_ENABLED: "false",
};

const sourceProduct = {
  id: 12,
  title: "自用劳力士日志型，广州面交",
  price: "¥6.38万",
  area: "广州",
  seller: "林小姐",
  link: "https://www.goofish.com/item?id=778899",
  image_url: "https://img.example.com/item.jpg",
  publish_time: "2026-08-30T10:00:00+08:00",
};

describe("validateLocalCollectorUrl", () => {
  it("accepts loopback services and rejects remote or credential-bearing URLs", () => {
    expect(validateLocalCollectorUrl("http://127.0.0.1:8000").port).toBe("8000");
    expect(() => validateLocalCollectorUrl("https://collector.example.com")).toThrow("本机回环地址");
    expect(() => validateLocalCollectorUrl("http://user:pass@localhost:8000")).toThrow("不能包含账号密码");
  });
});

describe("xianyuScanScope", () => {
  it("distinguishes the same keyword searched in different places", () => {
    const base = { keyword: "劳力士", maxPages: 1, mode: "fresh" as const, province: "广东", city: "广州" };
    expect(xianyuScanScope(base)).toBe(xianyuScanScope({ ...base }));
    expect(xianyuScanScope(base)).not.toBe(xianyuScanScope({ ...base, city: "佛山" }));
    expect(xianyuScanScope(base)).not.toBe(xianyuScanScope({ ...base, keyword: "欧米茄" }));
  });
});

describe("normalizeXianyuProduct", () => {
  it("maps the collector row into a conservative internal listing", () => {
    const listing = normalizeXianyuProduct(sourceProduct, { keyword: "劳力士", maxPages: 1, mode: "fresh" });

    expect(listing).toMatchObject({
      externalId: "778899",
      platform: "xianyu",
      category: "watch",
      brand: "劳力士",
      price: 63800,
      sourceUrl: "https://www.goofish.com/item?id=778899",
      hasPurchaseProof: false,
    });
  });

  it("skips rows with unusable prices", () => {
    expect(
      normalizeXianyuProduct({ ...sourceProduct, price: "价格异常" }, { keyword: "劳力士", maxPages: 1, mode: "fresh" as const }),
    ).toBeNull();
  });

  it("keeps all collector image URLs for the detail carousel", () => {
    const listing = normalizeXianyuProduct({
      ...sourceProduct,
      image_urls: JSON.stringify(["https://img.example.com/front.jpg", "https://img.example.com/back.jpg"]),
    }, { keyword: "劳力士", maxPages: 1, mode: "fresh" as const });

    expect(listing?.imageUrls).toEqual([
      "https://img.example.com/item.jpg",
      "https://img.example.com/front.jpg",
      "https://img.example.com/back.jpg",
    ]);
  });

  it("classifies from product content without requiring a category filter", () => {
    expect(inferListingCategory("卡地亚蓝气球腕表", "", "卡地亚")).toBe("watch");
    expect(inferListingCategory("LV 发财桶", "", "LV")).toBe("bag");
    expect(inferListingCategory("卡地亚 Love 戒指", "", "卡地亚")).toBe("jewelry");
    expect(inferListingCategory("个人闲置精品", "", "精品")).toBe("other");
  });

  it("recognizes Longines from the listing title without a detail snapshot", () => {
    const listing = normalizeXianyuProduct({ ...sourceProduct, title: "浪琴康卡斯 L3.781.4.56.6 自动机械男士腕表" }, { keyword: "腕表", maxPages: 1, mode: "fresh" as const });
    expect(listing).toMatchObject({ category: "watch", brand: "浪琴" });
  });
});

describe("detail and profile snapshots", () => {
  const detailJson = JSON.stringify({
    data: {
      itemDO: {
        desc: "24年带票98新原始出，附件肩带小票齐全，芯片可验",
        attributeList: [
          { name: "品牌", value: "Louis Vuitton/路易威登" },
          { name: "系列", value: "nano cannes 发财桶" },
          { name: "成色", value: "几乎全新" },
        ],
        soldCount: 2,
        wantCount: 15,
        viewCount: 130,
        userId: "2208691234567",
      },
      sellerDO: {
        hasSoldNumInteger: 1043,
      },
    },
  });
  const profileJson = JSON.stringify({
    nickName: "何富贵在奋斗ing",
    soldCount: 1043,
    onSaleCount: 462,
    creditLevel: "L6",
    registrationRaw: "2016-05-01",
    sampledCount: 30,
    categoryCounts: { 箱包: 28, 腕表: 2 },
  });

  it("derives facts, brand/model and stable seller identity from the detail snapshot", () => {
    const listing = normalizeXianyuProduct({
      ...sourceProduct,
      title: "24年带票98新原始出 LV路易威登 nano cannes 发财桶",
      detail_json: detailJson,
      seller_user_id: "2208691234567",
      seller_profile_json: profileJson,
    }, { keyword: "箱包", maxPages: 1, mode: "fresh" as const });

    expect(listing).toMatchObject({
      brand: "Louis Vuitton",
      model: "nano cannes 发财桶",
      description: "24年带票98新原始出，附件肩带小票齐全，芯片可验",
      hasSerialDetail: true,
      hasPurchaseProof: true,
      hasAccessoryDescription: true,
    });
    expect(listing?.seller).toMatchObject({
      externalId: "xianyu-user-2208691234567",
      identityScope: "stable-platform-id",
      completedSaleCount: 1043,
      completedSaleCountVerified: true,
      onSaleCount: 462,
      creditLevel: "L6",
      profileCategoryMix: { 箱包: 28, 腕表: 2 },
    });
    expect(listing?.seller.accountAgeDays).toBeGreaterThan(3000);
  });

  it("falls back to the legacy nickname key when the collector has no seller id", () => {
    const listing = normalizeXianyuProduct(sourceProduct, { keyword: "劳力士", maxPages: 1, mode: "fresh" });
    expect(listing?.seller.externalId).toBe(legacySellerExternalId("林小姐", "广州"));
    expect(listing?.seller.identityScope).toBe("nickname-region");
    expect(legacySellerExternalId("林小姐", "广州")).toMatch(/^nickname-[0-9a-f]{20}$/);
  });

  it("uses the detail seller card sold count when no profile snapshot exists", () => {
    const listing = normalizeXianyuProduct({
      ...sourceProduct,
      detail_json: detailJson,
      seller_user_id: "2208691234567",
    }, { keyword: "箱包", maxPages: 1, mode: "fresh" as const });
    expect(listing?.seller).toMatchObject({
      completedSaleCount: 1043,
      completedSaleCountVerified: true,
      identityScope: "stable-platform-id",
    });
    expect(listing?.seller.onSaleCount).toBeUndefined();
  });

  it("tolerates malformed or empty snapshots", () => {
    expect(parseDetailSnapshot(null)).toBeNull();
    expect(parseDetailSnapshot("not-json")).toBeNull();
    expect(parseDetailSnapshot(JSON.stringify({ data: {} }))).toBeNull();
    expect(parseSellerProfileSnapshot(undefined)).toBeNull();
    expect(parseSellerProfileSnapshot("[]")).toBeNull();
    const partial = parseDetailSnapshot(JSON.stringify({ data: { itemDO: { desc: "只有描述" } } }));
    expect(partial).toEqual({ description: "只有描述", attributes: [] });
  });

  it("parses registration age from dates, epochs and year strings", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    expect(accountAgeDaysFromRegistration("10年", now)).toBe(3650);
    expect(accountAgeDaysFromRegistration("2016-05-01", now)).toBeGreaterThan(3000);
    expect(accountAgeDaysFromRegistration("1462060800000", now)).toBeGreaterThan(3000);
    expect(accountAgeDaysFromRegistration("not-a-date", now)).toBeUndefined();
  });
});

describe("importXianyuSearch", () => {
  it("triggers the local collector, loads new ids and persists normalized rows", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ logged_in: true })))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          status: "success",
          keyword: "劳力士",
          logged_in: true,
          user_id: "local-user",
          total_results: 30,
          new_records: 1,
          new_record_ids: [12],
          record_ids: [12],
          enriched_details: 0,
          blocked_details: 1,
          seller_profiles: { fetched: 0, skipped: 0, failed: 1, cooldown: 0 },
        }),
        { status: 200 },
      ));
    const loadProducts = vi.fn().mockResolvedValue([sourceProduct]);
    const persistListings = vi.fn().mockResolvedValue({ imported: 1, filtered: 0, pendingEvaluation: 0 });
    const finishScanRun = vi.fn().mockResolvedValue(null);
    const scanRuns = {
      startScanRun: vi.fn().mockResolvedValue({ run: { id: "run-1", mode: "fresh" as const, startPage: 1, startedAt: new Date() }, reused: false, startPage: 1 }),
      finishScanRun,
    };

    await expect(
      importXianyuSearch(
        { keyword: "劳力士", maxPages: 1, mode: "fresh" as const, province: "广东", city: "广州" },
        { env, fetcher, loadProducts, persistListings, scanRuns },
      ),
    ).resolves.toEqual({
      keyword: "劳力士",
      loggedIn: true,
      totalResults: 30,
      newRecords: 1,
      importedRecords: 1,
      filteredRecords: 0,
      pendingEvaluation: 0,
      skippedRecords: 0,
      mode: "fresh",
      runId: "run-1",
      enrichedDetails: 0,
      blockedDetails: 1,
      sellerProfiles: { fetched: 0, skipped: 0, failed: 1, cooldown: 0 },
      items: [
        {
          externalId: "778899",
          title: "自用劳力士日志型，广州面交",
          price: 63800,
          region: "广州",
          publishedAt: "2026-08-30T02:00:00.000Z",
          sourceUrl: "https://www.goofish.com/item?id=778899",
          imageUrl: "https://img.example.com/item.jpg",
        },
      ],
    });

    expect(loadProducts).toHaveBeenCalledWith([12], env.XIANYU_COLLECTOR_DATABASE_URL);
    expect(persistListings).toHaveBeenCalledOnce();
    expect(persistListings).toHaveBeenCalledWith(expect.any(Array), [sourceProduct], xianyuScanScope({ keyword: "劳力士", maxPages: 1, mode: "fresh" as const, province: "广东", city: "广州" }));
    expect((fetcher.mock.calls[1]?.[1]?.headers as Headers).get("x-xianyu-service-token")).toBe("collector-token");
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ keyword: "劳力士", province: "广东", city: "广州", max_pages: 1, start_page: 1 });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).not.toHaveProperty("category");
  });

  it("does not search or persist when the xianyu session is logged out", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ logged_in: false })));
    const persistListings = vi.fn();

    await expect(
      importXianyuSearch(
        { keyword: "劳力士", maxPages: 1, mode: "fresh" as const },
        { env, fetcher, persistListings },
      ),
    ).rejects.toThrow("先在连接与控制页面完成闲鱼账号登录");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(persistListings).not.toHaveBeenCalled();
  });
});
