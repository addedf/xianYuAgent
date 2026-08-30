import { describe, expect, it } from "vitest";
import type { ServerEnv } from "@/src/server/env";
import {
  adminAuthConfigurationError,
  createAdminSessionToken,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from "./admin-session";

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

describe("admin session", () => {
  it("requires strong local configuration and compares the configured password", () => {
    expect(adminAuthConfigurationError(env)).toBeNull();
    expect(verifyAdminPassword(env.ADMIN_PASSWORD, env)).toBe(true);
    expect(verifyAdminPassword("wrong-password", env)).toBe(false);
    expect(adminAuthConfigurationError({ ...env, ADMIN_SESSION_SECRET: "short" })).toContain("32");
  });

  it("accepts a signed session before expiry and rejects tampering or expiry", () => {
    const now = Date.UTC(2026, 7, 30, 10, 0, 0);
    const token = createAdminSessionToken(env, now);
    expect(verifyAdminSessionToken(token, env, now + 1_000)).toBe(true);
    expect(verifyAdminSessionToken(`${token}x`, env, now + 1_000)).toBe(false);
    expect(verifyAdminSessionToken(token, env, now + 9 * 60 * 60 * 1_000)).toBe(false);
  });
});
