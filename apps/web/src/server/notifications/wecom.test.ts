import { describe, expect, it, vi } from "vitest";
import { assessedDemoListings } from "@/src/data/demo";
import { formatLeadNotification, sendWeComMarkdown, validateWeComWebhook } from "./wecom";

describe("validateWeComWebhook", () => {
  it("accepts the official HTTPS robot endpoint", () => {
    expect(validateWeComWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key").hostname).toBe(
      "qyapi.weixin.qq.com",
    );
  });

  it("rejects non-official hosts to prevent SSRF", () => {
    expect(() => validateWeComWebhook("https://example.com/cgi-bin/webhook/send?key=test-key")).toThrow(
      "qyapi.weixin.qq.com",
    );
  });

  it("rejects malformed URLs and official URLs without a robot key", () => {
    expect(() => validateWeComWebhook("not-a-url")).toThrow("不是有效 URL");
    expect(() => validateWeComWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send")).toThrow("缺少机器人 key");
  });
});

describe("sendWeComMarkdown", () => {
  it("normalizes a successful provider response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      sendWeComMarkdown("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key", "测试", fetcher),
    ).resolves.toEqual({ ok: true, providerCode: 0, message: "通知已送达企业微信。" });
  });

  it("does not expose the webhook when the provider fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("error", { status: 500 }));
    const result = await sendWeComMarkdown(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=private-key",
      "测试",
      fetcher,
    );

    expect(result.message).not.toContain("private-key");
    expect(result.ok).toBe(false);
  });

  it("rejects empty content before making a network request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      sendWeComMarkdown("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key", "   ", fetcher),
    ).rejects.toThrow("通知内容不能为空");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes malformed and rejected provider responses", async () => {
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );
    await expect(
      sendWeComMarkdown("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key", "测试", malformedFetcher),
    ).resolves.toEqual({ ok: false, providerCode: -1, message: "企业微信返回了无法识别的响应。" });

    const rejectedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid robot" }), { status: 200 }),
    );
    await expect(
      sendWeComMarkdown("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key", "测试", rejectedFetcher),
    ).resolves.toEqual({ ok: false, providerCode: 93000, message: "企业微信拒绝请求：invalid robot" });
  });
});

describe("formatLeadNotification", () => {
  it("renders traceable listing and ruleset evidence", () => {
    const { listing, assessment } = assessedDemoListings[0];
    const message = formatLeadNotification(listing, assessment);

    expect(message).toContain(listing.brand);
    expect(message).toContain(`规则版本：${assessment.rulesetVersion}`);
    expect(message).toContain("主要依据");
  });
});
