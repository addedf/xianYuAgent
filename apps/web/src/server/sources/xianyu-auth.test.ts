import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@/src/server/env";
import {
  getXianyuAuthStatus,
  pollXianyuQrLogin,
  pollXianyuSmsLogin,
  startXianyuQrLogin,
  startXianyuSmsLogin,
  verifyXianyuSmsLogin,
} from "./xianyu-auth";

const env = {
  APP_DEMO_MODE: "false",
  DATABASE_URL: "",
  REDIS_URL: "",
  WECOM_WEBHOOK_URL: "",
  ADMIN_PASSWORD: "a-long-local-password",
  ADMIN_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  XIANYU_COLLECTOR_ENABLED: "true",
  XIANYU_COLLECTOR_URL: "http://127.0.0.1:8000",
  XIANYU_COLLECTOR_API_TOKEN: "collector-token",
  XIANYU_COLLECTOR_DATABASE_URL: "",
  OUTBOUND_MESSAGING_ENABLED: "false",
} satisfies ServerEnv;

describe("xianyu auth facade", () => {
  it("sends the internal token and returns only a sanitized login view", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ logged_in: true, user_id: "private-user", cookies: { cookie2: "secret" } })),
    );
    const result = await getXianyuAuthStatus({ env, fetcher });
    expect(result).toEqual({ loggedIn: true, state: "authenticated", message: "闲鱼账号已连接，可以搜索真实商品。" });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(expect.any(Headers));
    expect((fetcher.mock.calls[0]?.[1]?.headers as Headers).get("x-xianyu-service-token")).toBe("collector-token");
    expect(JSON.stringify(result)).not.toContain("private-user");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("starts and polls a QR session without returning raw QR content or verification URLs", async () => {
    const sessionId = "a".repeat(32);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ logged_in: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_id: sessionId, qr_image_base64: "QUJDRA==", qr_content: "secret" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "verification_required",
        verification_pending: true,
        verification_qr_image_base64: "RUZHSA==",
        verification_url: "https://passport.example/secret",
      })));

    await expect(startXianyuQrLogin({ env, fetcher })).resolves.toMatchObject({
      state: "waiting_scan",
      sessionId,
      qrImageBase64: "QUJDRA==",
    });
    const polled = await pollXianyuQrLogin(sessionId, { env, fetcher });
    expect(polled).toMatchObject({ state: "verification_required", qrImageBase64: "RUZHSA==" });
    expect(JSON.stringify(polled)).not.toContain("passport.example");
  });

  it("proxies SMS login without returning the phone or verification code", async () => {
    const sessionId = "b".repeat(32);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "code_sent",
        session_id: sessionId,
        resend_after: 60,
        phone: "13800138000",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "verification_required",
        session_id: sessionId,
        resend_after: 30,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: true,
        status: "authenticated",
        session_id: sessionId,
        resend_after: 0,
        code: "123456",
      })));

    const started = await startXianyuSmsLogin("13800138000", { env, fetcher });
    expect(started).toMatchObject({
      state: "sms_code_sent",
      method: "sms",
      sessionId,
      resendAfter: 60,
    });
    expect(JSON.stringify(started)).not.toContain("13800138000");

    await expect(pollXianyuSmsLogin(sessionId, { env, fetcher })).resolves.toMatchObject({
      state: "sms_verification_required",
      method: "sms",
    });
    const verified = await verifyXianyuSmsLogin(sessionId, "123456", { env, fetcher });
    expect(verified).toMatchObject({ state: "authenticated", loggedIn: true });
    expect(JSON.stringify(verified)).not.toContain("123456");
  });
});
