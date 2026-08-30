import { Queue } from "bullmq";
import Redis from "ioredis";
import { getServerEnv } from "@/src/server/env";

export const QUEUE_NAME = "xianyu-agent-events";

export interface WeComNotificationJob {
  kind: "wecom.notify";
  listingId: string;
  idempotencyKey: string;
}

export function createRedisConnection(): Redis {
  const { REDIS_URL } = getServerEnv();
  if (!REDIS_URL) throw new Error("REDIS_URL 未配置，后台队列无法启动。");

  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createEventQueue(connection = createRedisConnection()): Queue<WeComNotificationJob> {
  return new Queue<WeComNotificationJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 2_000 },
    },
  });
}

