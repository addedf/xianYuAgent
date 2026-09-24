ALTER TABLE "assessments" ADD COLUMN "model_confidence" integer;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "model_evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "input_fingerprint" text;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "absent_scan_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO "system_controls" ("control_key", "enabled", "reason") VALUES ('jev-evaluation', false, 'JEV 默认关闭，启用前需完成 Key、额度与真实连通验证。') ON CONFLICT ("control_key") DO NOTHING;
--> statement-breakpoint
