import { describe, expect, it, vi } from "vitest";
import { getServerEnv, type ServerEnv } from "@/src/server/env";
import { importXianyuSearch, normalizeXianyuProduct, validateLocalCollectorUrl } from "./xianyu-spider";

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

describe("normalizeXianyuProduct", () => {
  it("maps the collector row into a conservative internal listing", () => {
    const listing = normalizeXianyuProduct(sourceProduct, { keyword: "劳力士", category: "watch", maxPages: 1 });

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
      normalizeXianyuProduct({ ...sourceProduct, price: "价格异常" }, { keyword: "劳力士", category: "watch", maxPages: 1 }),
    ).toBeNull();
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
        }),
        { status: 200 },
      ));
    const loadProducts = vi.fn().mockResolvedValue([sourceProduct]);
    const persistListings = vi.fn().mockResolvedValue(1);

    await expect(
      importXianyuSearch(
        { keyword: "劳力士", category: "watch", maxPages: 1, city: "广州" },
        { env, fetcher, loadProducts, persistListings },
      ),
    ).resolves.toEqual({
      keyword: "劳力士",
      loggedIn: true,
      totalResults: 30,
      newRecords: 1,
      importedRecords: 1,
      skippedRecords: 0,
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
    expect((fetcher.mock.calls[1]?.[1]?.headers as Headers).get("x-xianyu-service-token")).toBe("collector-token");
  });

  it("does not search or persist when the xianyu session is logged out", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ logged_in: false })));
    const persistListings = vi.fn();

    await expect(
      importXianyuSearch(
        { keyword: "劳力士", category: "watch", maxPages: 1 },
        { env, fetcher, persistListings },
      ),
    ).rejects.toThrow("先在连接与控制页面完成闲鱼账号登录");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(persistListings).not.toHaveBeenCalled();
  });
});
