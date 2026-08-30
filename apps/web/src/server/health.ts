import Redis from "ioredis";
import postgres from "postgres";
import { getServerEnv } from "@/src/server/env";

export type ServiceState = "ready" | "not-configured" | "unavailable";

export interface ServiceHealth {
  name: "postgresql" | "redis" | "wecom";
  state: ServiceState;
  detail: string;
  latencyMs?: number;
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

export async function getSystemHealth(): Promise<ServiceHealth[]> {
  const env = getServerEnv();
  const [postgresql, redis] = await Promise.all([
    checkPostgreSql(env.DATABASE_URL),
    checkRedis(env.REDIS_URL),
  ]);

  return [
    postgresql,
    redis,
    {
      name: "wecom",
      state: env.WECOM_WEBHOOK_URL ? "ready" : "not-configured",
      detail: env.WECOM_WEBHOOK_URL ? "Webhook 已配置，可发送测试通知。" : "等待填写 WECOM_WEBHOOK_URL。",
    },
  ];
}

