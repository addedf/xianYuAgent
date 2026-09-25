import { z } from "zod";

const serverEnvSchema = z.object({
  APP_DEMO_MODE: z.enum(["true", "false"]).optional().default("true"),
  DATABASE_URL: z.string().trim().optional().default(""),
  REDIS_URL: z.string().trim().optional().default(""),
  WECOM_WEBHOOK_URL: z.string().trim().optional().default(""),
  ADMIN_PASSWORD: z.string().optional().default(""),
  ADMIN_SESSION_SECRET: z.string().trim().optional().default(""),
  XIANYU_COLLECTOR_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  XIANYU_COLLECTOR_URL: z.string().trim().optional().default("http://127.0.0.1:8000"),
  XIANYU_COLLECTOR_API_TOKEN: z.string().trim().optional().default(""),
  XIANYU_COLLECTOR_DATABASE_URL: z.string().trim().optional().default(""),
  OUTBOUND_MESSAGING_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  TYPESAFE_API_KEY: z.string().trim().optional().default(""),
  TYPESAFE_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  TYPESAFE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).optional().default(8_000),
  TYPESAFE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).optional().default(30),
  TYPESAFE_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).optional().default(55),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

export function isDemoMode(env = getServerEnv()): boolean {
  return env.APP_DEMO_MODE !== "false" || !env.DATABASE_URL;
}
