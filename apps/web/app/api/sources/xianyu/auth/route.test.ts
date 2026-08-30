import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminApiError: vi.fn(() => null),
  getServerEnv: vi.fn(() => ({})),
  getXianyuAuthStatus: vi.fn(),
  startXianyuQrLogin: vi.fn(),
  pollXianyuQrLogin: vi.fn(),
  startXianyuBrowserLogin: vi.fn(),
  pollXianyuBrowserLogin: vi.fn(),
  cancelXianyuBrowserLogin: vi.fn(),
  logoutXianyu: vi.fn(),
}));

vi.mock("@/src/server/auth/admin-request", () => ({ adminApiError: mocks.adminApiError }));
vi.mock("@/src/server/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/src/server/sources/xianyu-auth", () => ({
  getXianyuAuthStatus: mocks.getXianyuAuthStatus,
  startXianyuQrLogin: mocks.startXianyuQrLogin,
  pollXianyuQrLogin: mocks.pollXianyuQrLogin,
  startXianyuBrowserLogin: mocks.startXianyuBrowserLogin,
  pollXianyuBrowserLogin: mocks.pollXianyuBrowserLogin,
  cancelXianyuBrowserLogin: mocks.cancelXianyuBrowserLogin,
  logoutXianyu: mocks.logoutXianyu,
}));

import { POST } from "./route";

const sessionId = "a".repeat(32);
const auth = {
  loggedIn: false,
  state: "browser_waiting",
  message: "等待本人完成登录。",
  sessionId,
  method: "browser",
};

function actionRequest(body: unknown): Request {
  return new Request("http://127.0.0.1:3001/api/sources/xianyu/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("xianyu auth route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startXianyuBrowserLogin.mockResolvedValue(auth);
    mocks.pollXianyuBrowserLogin.mockResolvedValue(auth);
    mocks.cancelXianyuBrowserLogin.mockResolvedValue({ ...auth, state: "canceled" });
  });

  it.each([
    ["browser_start", { action: "browser_start" }, mocks.startXianyuBrowserLogin, undefined],
    ["browser_poll", { action: "browser_poll", sessionId }, mocks.pollXianyuBrowserLogin, sessionId],
    ["browser_cancel", { action: "browser_cancel", sessionId }, mocks.cancelXianyuBrowserLogin, sessionId],
  ] as const)("dispatches %s", async (_name, body, target, expectedSessionId) => {
    const response = await POST(actionRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("auth");
    expect(target).toHaveBeenCalledTimes(1);
    if (expectedSessionId) expect(target).toHaveBeenCalledWith(expectedSessionId, expect.any(Object));
    else expect(target).toHaveBeenCalledWith(expect.any(Object));
  });

  it("rejects the removed Web SMS contract instead of treating it as logout", async () => {
    const response = await POST(actionRequest({ action: "sms_start" }));

    expect(response.status).toBe(400);
    expect(mocks.logoutXianyu).not.toHaveBeenCalled();
  });

  it("does not expose unexpected internal errors", async () => {
    mocks.startXianyuBrowserLogin.mockRejectedValueOnce(new Error("cookie2=secret"));

    const response = await POST(actionRequest({ action: "browser_start" }));
    const result = await response.json() as { error: string };

    expect(response.status).toBe(502);
    expect(result.error).toBe("闲鱼登录操作失败，请检查本机采集器状态。");
    expect(result.error).not.toContain("secret");
  });
});
