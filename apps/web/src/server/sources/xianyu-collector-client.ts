import type { ServerEnv } from "@/src/server/env";

export interface CollectorClientDependencies {
  env: ServerEnv;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function validateLocalCollectorUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("闲鱼采集器地址不是有效 URL。");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!localHosts.has(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("闲鱼采集器只允许连接本机回环地址，且地址中不能包含账号密码。");
  }
  return url;
}

export function assertCollectorConfiguration(env: ServerEnv): void {
  if (env.XIANYU_COLLECTOR_ENABLED !== "true") throw new Error("闲鱼只读采集器尚未启用。");
  if (!env.XIANYU_COLLECTOR_API_TOKEN) throw new Error("XIANYU_COLLECTOR_API_TOKEN 尚未配置。");
}

export async function requestXianyuCollector(
  path: string,
  init: RequestInit,
  dependencies: CollectorClientDependencies,
): Promise<unknown> {
  assertCollectorConfiguration(dependencies.env);
  const baseUrl = validateLocalCollectorUrl(dependencies.env.XIANYU_COLLECTOR_URL);
  const headers = new Headers(init.headers);
  headers.set("x-xianyu-service-token", dependencies.env.XIANYU_COLLECTOR_API_TOKEN);

  const response = await (dependencies.fetcher ?? fetch)(new URL(path, baseUrl), {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(dependencies.timeoutMs ?? 60_000),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 503) {
      throw new Error("Web 与闲鱼采集器的内部服务鉴权失败。");
    }
    if (response.status === 409) {
      throw new Error("闲鱼要求完成官方安全验证，请断开账号后重新扫码并按 App 提示确认。");
    }
    throw new Error("本地闲鱼采集器请求失败，请检查采集器状态。");
  }
  return response.json();
}
