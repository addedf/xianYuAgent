import { Worker } from "bullmq";
import { assessedDemoListings } from "../src/data/demo";
import { getServerEnv } from "../src/server/env";
import { formatLeadNotification, sendWeComMarkdown } from "../src/server/notifications/wecom";
import { createRedisConnection, QUEUE_NAME, type WeComNotificationJob } from "../src/server/queue";

const env = getServerEnv();
const connection = createRedisConnection();

const worker = new Worker<WeComNotificationJob>(
  QUEUE_NAME,
  async (job) => {
    if (job.data.kind !== "wecom.notify") throw new Error(`不支持的任务类型：${job.data.kind}`);
    if (!env.WECOM_WEBHOOK_URL) throw new Error("WECOM_WEBHOOK_URL 未配置。");

    const candidate = assessedDemoListings.find(({ listing }) => listing.id === job.data.listingId);
    if (!candidate) throw new Error("通知任务引用的线索不存在。");

    const result = await sendWeComMarkdown(
      env.WECOM_WEBHOOK_URL,
      formatLeadNotification(candidate.listing, candidate.assessment),
    );
    if (!result.ok) throw new Error(result.message);
    return { delivered: true, providerCode: result.providerCode };
  },
  { connection, concurrency: 2 },
);

worker.on("completed", (job) => {
  console.info(`[worker] completed job=${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed job=${job?.id ?? "unknown"} reason=${error.message}`);
});

async function shutdown() {
  await worker.close();
  connection.disconnect();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.info(`[worker] listening queue=${QUEUE_NAME}`);

