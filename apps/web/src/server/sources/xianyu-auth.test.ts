import { describe, expect, it, vi } from "vitest";
import { getServerEnv, type ServerEnv } from "@/src/server/env";
import {
  cancelXianyuBrowserLogin,
  getXianyuAuthStatus,
  pollXianyuBrowserLogin,
  pollXianyuQrLogin,
  startXianyuBrowserLogin,
  startXianyuQrLogin,
} from "./xianyu-auth";

const env = {
  ...getServerEnv({ NODE_ENV: "test" }),
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
  it("sends the internal token and returns a sanitized login view with capabilities", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        logged_in: true,
        user_id: "private-user",
        cookies: { cookie2: "secret" },
        capabilities: { browser_login: true, qr_login: true, sms_login: false },
      })),
    );
    const result = await getXianyuAuthStatus({ env, fetcher });
    expect(result).toEqual({
      loggedIn: true,
      state: "authenticated",
      message: "闲鱼账号已连接，可以搜索真实商品。",
      capabilities: { browserLogin: true, qrLogin: true },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(expect.any(Headers));
    expect((fetcher.mock.calls[0]?.[1]?.headers as Headers).get("x-xianyu-service-token")).toBe("collector-token");
    expect(JSON.stringify(result)).not.toContain("private-user");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("treats browser login as unsupported when an older collector omits capabilities", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ logged_in: false })),
    );

    await expect(getXianyuAuthStatus({ env, fetcher })).resolves.toMatchObject({
      capabilities: { browserLogin: false, qrLogin: true },
    });
  });

  it("keeps a transient collector probe failure distinct from an expired login", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        logged_in: false,
        status_unavailable: true,
        hint: "upstream detail must not cross the BFF",
        capabilities: { browser_login: true, qr_login: true },
      })),
    );

    const result = await getXianyuAuthStatus({ env, fetcher });
    expect(result).toMatchObject({
      loggedIn: false,
      state: "unavailable",
      capabilities: { browserLogin: true, qrLogin: true },
    });
    expect(JSON.stringify(result)).not.toContain("upstream detail");
  });

  it("starts and polls a QR session without returning verification URLs", async () => {
    const sessionId = "a".repeat(32);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        capabilities: { browser_login: true, qr_login: true },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        session_id: sessionId,
        qr_image_base64: "QUJDRA==",
        qr_content: "secret",
      })))
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
      capabilities: { browserLogin: true, qrLogin: true },
    });
    const polled = await pollXianyuQrLogin(sessionId, { env, fetcher });
    expect(polled).toMatchObject({ state: "verification_required", qrImageBase64: "RUZHSA==" });
    expect(JSON.stringify(polled)).not.toContain("passport.example");
  });

  it("starts, polls, and cancels an official browser session with fixed sanitized messages", async () => {
    const sessionId = "b".repeat(32);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        capabilities: { browser_login: true, qr_login: true, sms_login: false },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "opening",
        session_id: sessionId,
        hint: "secret upstream hint",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "waiting_for_user",
        session_id: sessionId,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        logged_in: false,
        status: "canceled",
        session_id: sessionId,
      })));

    const started = await startXianyuBrowserLogin({ env, fetcher });
    expect(started).toMatchObject({
      state: "browser_opening",
      method: "browser",
      sessionId,
    });
    expect(JSON.stringify(started)).not.toContain("secret upstream hint");
    await expect(pollXianyuBrowserLogin(sessionId, { env, fetcher })).resolves.toMatchObject({
      state: "browser_waiting",
      method: "browser",
    });
    await expect(cancelXianyuBrowserLogin(sessionId, { env, fetcher })).resolves.toMatchObject({
      state: "canceled",
      method: "browser",
    });

    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["http://127.0.0.1:8000/auth/status", "GET"],
      ["http://127.0.0.1:8000/auth/browser/start", "POST"],
      [`http://127.0.0.1:8000/auth/browser/status?session_id=${sessionId}`, "GET"],
      [`http://127.0.0.1:8000/auth/browser/cancel?session_id=${sessionId}`, "POST"],
    ]);
  });

  it("does not call a missing browser endpoint on an older collector", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ logged_in: false })),
    );

    await expect(startXianyuBrowserLogin({ env, fetcher })).rejects.toThrow(
      "当前闲鱼采集器版本不支持官方窗口登录",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8000/auth/status");
  });
});
