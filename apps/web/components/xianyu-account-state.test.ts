import { describe, expect, it } from "vitest";
import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";
import { mergeXianyuAuthPoll } from "./xianyu-account-state";

const sessionId = "a".repeat(32);

function auth(overrides: Partial<XianyuAuthView> = {}): XianyuAuthView {
  return {
    loggedIn: false,
    state: "waiting_scan",
    message: "等待扫码",
    sessionId,
    ...overrides,
  };
}

describe("mergeXianyuAuthPoll", () => {
  it.each(["waiting_scan", "scanned", "confirming"] as const)(
    "keeps the login QR while the same session is %s",
    (state) => {
      const previous = auth({ qrImageBase64: "LOGIN_QR" });
      expect(mergeXianyuAuthPoll(previous, auth({ state }))).toMatchObject({
        state,
        qrImageBase64: "LOGIN_QR",
      });
    },
  );

  it("uses a new verification QR instead of the login QR", () => {
    const previous = auth({ qrImageBase64: "LOGIN_QR" });
    expect(mergeXianyuAuthPoll(previous, auth({
      state: "verification_required",
      qrImageBase64: "VERIFY_QR",
    }))).toMatchObject({ qrImageBase64: "VERIFY_QR" });
  });

  it.each(["verification_required", "expired", "authenticated", "canceled"] as const)(
    "clears a stale login QR when the state becomes %s",
    (state) => {
      const previous = auth({ qrImageBase64: "LOGIN_QR" });
      expect(mergeXianyuAuthPoll(previous, auth({
        state,
        loggedIn: state === "authenticated",
      })).qrImageBase64).toBeUndefined();
    },
  );

  it("does not carry a QR into a different session", () => {
    const previous = auth({ qrImageBase64: "LOGIN_QR" });
    expect(mergeXianyuAuthPoll(previous, auth({ sessionId: "b".repeat(32) })).qrImageBase64)
      .toBeUndefined();
  });
});
