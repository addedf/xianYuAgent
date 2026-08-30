import { describe, expect, it } from "vitest";
import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";
import {
  failXianyuAuthPoll,
  isXianyuAuthTerminal,
  mergeXianyuAuthPoll,
  xianyuAuthPollAction,
} from "./xianyu-account-state";

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

  it("keeps capability declarations while polling a session", () => {
    const previous = auth({ capabilities: { qrLogin: true, browserLogin: true } });
    expect(mergeXianyuAuthPoll(previous, auth({ state: "scanned" }))).toMatchObject({
      capabilities: { qrLogin: true, browserLogin: true },
    });
  });
});

describe("xianyuAuthPollAction", () => {
  it("selects the matching QR or browser status endpoint", () => {
    expect(xianyuAuthPollAction(auth({ method: "qr" }))).toEqual({ action: "poll", sessionId });
    expect(xianyuAuthPollAction(auth({ method: "browser", state: "browser_waiting" }))).toEqual({
      action: "browser_poll",
      sessionId,
    });
  });

  it.each(["authenticated", "expired", "canceled", "browser_failed"] as const)(
    "stops polling when the session is %s",
    (state) => {
      const value = auth({ state, loggedIn: state === "authenticated", method: "browser" });
      expect(xianyuAuthPollAction(value)).toBeNull();
      expect(isXianyuAuthTerminal(value)).toBe(true);
    },
  );

  it("unlocks the UI after repeated browser or QR polling failures", () => {
    const browserFailure = failXianyuAuthPoll(auth({
      method: "browser",
      state: "browser_waiting",
    }));
    expect(browserFailure.state).toBe("browser_failed");
    expect(xianyuAuthPollAction(browserFailure)).toBeNull();

    const qrFailure = failXianyuAuthPoll(auth({ method: "qr", qrImageBase64: "LOGIN_QR" }));
    expect(qrFailure).toMatchObject({ state: "expired", qrImageBase64: undefined });
    expect(xianyuAuthPollAction(qrFailure)).toBeNull();
  });
});
