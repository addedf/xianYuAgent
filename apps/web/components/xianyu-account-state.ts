import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";

const loginQrStates = new Set<XianyuAuthView["state"]>([
  "waiting_scan",
  "scanned",
  "confirming",
]);

const terminalStates = new Set<XianyuAuthView["state"]>([
  "authenticated",
  "expired",
  "canceled",
  "browser_failed",
]);

export type XianyuAuthPollAction =
  | { action: "poll"; sessionId: string }
  | { action: "browser_poll"; sessionId: string };

export function xianyuAuthPollAction(auth: XianyuAuthView | null): XianyuAuthPollAction | null {
  if (!auth?.sessionId || auth.loggedIn || terminalStates.has(auth.state)) return null;
  return auth.method === "browser"
    ? { action: "browser_poll", sessionId: auth.sessionId }
    : { action: "poll", sessionId: auth.sessionId };
}

export function isXianyuAuthTerminal(auth: XianyuAuthView): boolean {
  return auth.loggedIn || terminalStates.has(auth.state);
}

export function failXianyuAuthPoll(auth: XianyuAuthView): XianyuAuthView {
  if (auth.method === "browser") {
    return {
      ...auth,
      loggedIn: false,
      state: "browser_failed",
      message: "连续多次无法读取官方窗口状态，请确认采集器运行后重新打开登录窗口。",
    };
  }
  return {
    ...auth,
    loggedIn: false,
    state: "expired",
    message: "连续多次无法读取扫码状态，请确认采集器运行后重新生成二维码。",
    qrImageBase64: undefined,
  };
}

export function mergeXianyuAuthPoll(
  previous: XianyuAuthView | null,
  next: XianyuAuthView,
): XianyuAuthView {
  const canKeepLoginQr = Boolean(
    previous?.qrImageBase64
      && previous.sessionId
      && previous.sessionId === next.sessionId
      && !next.qrImageBase64
      && loginQrStates.has(next.state),
  );

  const merged = canKeepLoginQr
    ? { ...next, qrImageBase64: previous?.qrImageBase64 }
    : next;

  return previous?.capabilities && !merged.capabilities
    ? { ...merged, capabilities: previous.capabilities }
    : merged;
}
