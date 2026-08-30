import { z } from "zod";

const serverEnvSchema = z.object({
  APP_DEMO_MODE: z.enum(["true", "false"]).optional().default("true"),
  DATABASE_URL: z.string().trim().optional().default(""),
  REDIS_URL: z.string().trim().optional().default(""),
  WECOM_WEBHOOK_URL: z.string().trim().optional().default(""),
  OUTBOUND_MESSAGING_ENABLED: z.enum(["true", "false"]).optional().default("false"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

export function isDemoMode(env = getServerEnv()): boolean {
  return env.APP_DEMO_MODE !== "false" || !env.DATABASE_URL;
}

