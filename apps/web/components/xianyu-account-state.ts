import type { XianyuAuthView } from "@/src/server/sources/xianyu-auth";

const loginQrStates = new Set<XianyuAuthView["state"]>([
  "waiting_scan",
  "scanned",
  "confirming",
]);

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

  return canKeepLoginQr
    ? { ...next, qrImageBase64: previous?.qrImageBase64 }
    : next;
}
