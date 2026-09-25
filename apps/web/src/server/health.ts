import Redis from "ioredis";
import postgres from "postgres";
import { getServerEnv } from "@/src/server/env";
import type { ServerEnv } from "@/src/server/env";
import { getXianyuAuthStatus } from "@/src/server/sources/xianyu-auth";
import { getDatabase } from "@/src/server/db/client";
import { eq } from "drizzle-orm";
import { systemControls } from "@/src/server/db/schema";

export type ServiceState = "ready" | "not-configured" | "unavailable";

export interface ServiceHealth {
  name: "postgresql" | "redis" | "wecom" | "xianyu-collector" | "typesafe";
  state: ServiceState;
  detail: string;
  latencyMs?: number;
}

async function checkXianyuCollector(env: ServerEnv): Promise<ServiceHealth> {
  if (env.XIANYU_COLLECTOR_ENABLED !== "true" || !env.XIANYU_COLLECTOR_API_TOKEN) {
    return {
      name: "xianyu-collector",
      state: "not-configured",
      detail: "只读采集器默认关闭；完成本地登录与数据库配置后再启用。",
    };
  }

  const startedAt = performance.now();
  try {
    const auth = await getXianyuAuthStatus({ env, timeoutMs: 2_000 });
    return {
      name: "xianyu-collector",
      state: "ready",
      detail: auth.loggedIn ? "采集服务正常，闲鱼登录态有效。" : "采集服务正常；当前为未登录或登录已过期状态。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      name: "xianyu-collector",
      state: "unavailable",
      detail: "无法连接本机 8000 端口的只读采集服务。",
    };
  }
}

async function checkPostgreSql(databaseUrl: string): Promise<ServiceHealth> {
  if (!databaseUrl) {
    return { name: "postgresql", state: "not-configured", detail: "已检测到本机服务；等待填写 DATABASE_URL。" };
  }

  const startedAt = performance.now();
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 2, idle_timeout: 2, prepare: false });
  try {
    await client`select 1 as ok`;
    return {
      name: "postgresql",
      state: "ready",
      detail: "连接与查询正常。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { name: "postgresql", state: "unavailable", detail: "连接失败，请核对数据库名、用户名和密码。" };
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function checkRedis(redisUrl: string): Promise<ServiceHealth> {
  if (!redisUrl) {
    return { name: "redis", state: "not-configured", detail: "本机 Redis 已启用认证；等待填写 REDIS_URL。" };
  }

  const startedAt = performance.now();
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    await client.ping();
    return {
      name: "redis",
      state: "ready",
      detail: "认证与 PING 正常。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { name: "redis", state: "unavailable", detail: "连接失败，请核对 Redis 密码和数据库编号。" };
  } finally {
    client.disconnect();
  }
}

export async function checkTypesafe(env: ServerEnv = getServerEnv()): Promise<ServiceHealth> {
  if (env.TYPESAFE_ENABLED !== "true") {
    return { name: "typesafe", state: "not-configured", detail: "JEV 评估总开关已关闭；评分暂停，新线索保持待评分状态，恢复后自动补评。" };
  }
  if (!env.TYPESAFE_API_KEY) {
    return { name: "typesafe", state: "unavailable", detail: "JEV 已启用但未配置 TYPESAFE_API_KEY；评分暂停，新线索保持待评分状态。" };
  }
  if (!env.DATABASE_URL) {
    return { name: "typesafe", state: "unavailable", detail: "JEV 已配置，但没有数据库可读取 jev-evaluation 总开关。" };
  }
  try {
    const { db } = getDatabase();
    const [control] = await db.select({ enabled: systemControls.enabled }).from(systemControls).where(eq(systemControls.controlKey, "jev-evaluation")).limit(1);
    return control?.enabled
      ? { name: "typesafe", state: "ready", detail: "JEV 已启用，评分正常；Key 仅在服务端环境变量中读取。" }
      : { name: "typesafe", state: "not-configured", detail: "JEV 环境已配置，但数据库总开关仍关闭；评分暂停，恢复后自动补评。" };
  } catch {
    return { name: "typesafe", state: "unavailable", detail: "无法读取 JEV 数据库总开关；评分暂停，新线索保持待评分状态。" };
  }
}

export async function getSystemHealth(): Promise<ServiceHealth[]> {
  const env = getServerEnv();
  const [postgresql, redis, xianyuCollector, typesafe] = await Promise.all([
    checkPostgreSql(env.DATABASE_URL),
    checkRedis(env.REDIS_URL),
    checkXianyuCollector(env),
    checkTypesafe(env),
  ]);

  return [
    postgresql,
    redis,
    xianyuCollector,
    typesafe,
    {
      name: "wecom",
      state: env.WECOM_WEBHOOK_URL ? "ready" : "not-configured",
      detail: env.WECOM_WEBHOOK_URL ? "Webhook 已配置，可发送测试通知。" : "等待填写 WECOM_WEBHOOK_URL。",
    },
  ];
}
