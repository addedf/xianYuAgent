-- 观察索引 / 统一排除记录 / 商品处理记录：与采集器（Tortoise）共享同一 PostgreSQL，
-- 双方都会幂等建表（Web 走本迁移，采集器走 generate_schemas(safe=True)），因此全部 IF NOT EXISTS。
CREATE TABLE IF NOT EXISTS "xianyu_listing_handling" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'xianyu' NOT NULL,
	"external_id" text NOT NULL,
	"handling" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xianyu_listing_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'xianyu' NOT NULL,
	"external_id" text NOT NULL,
	"seller_identity_key" text NOT NULL,
	"seller_nickname" text DEFAULT '' NOT NULL,
	"seller_area" text DEFAULT '' NOT NULL,
	"stable_seller_id" text,
	"category" text,
	"title" text DEFAULT '' NOT NULL,
	"price" text DEFAULT '' NOT NULL,
	"first_published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xianyu_seller_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'xianyu' NOT NULL,
	"identity_key" text NOT NULL,
	"identity_type" text DEFAULT 'nickname-area' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text DEFAULT '{}' NOT NULL,
	"rule_version" text,
	"status" text DEFAULT 'active' NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"events" text DEFAULT '[]' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "identity_key" text;--> statement-breakpoint
-- 存量回填：稳定 ID 卖家直接用平台键；旧「昵称+地区」哈希卖家回到弱身份键原文。
UPDATE "sellers" SET "identity_key" = CASE
	WHEN "external_id" LIKE 'xianyu-user-%' THEN "external_id"
	ELSE COALESCE("display_name", '') || '|' || COALESCE("region", '')
END
WHERE "identity_key" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "xianyu_handling_external_unique" ON "xianyu_listing_handling" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "xianyu_observation_external_unique" ON "xianyu_listing_observations" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xianyu_observation_seller_idx" ON "xianyu_listing_observations" USING btree ("seller_identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "xianyu_exclusion_identity_unique" ON "xianyu_seller_exclusions" USING btree ("platform","identity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sellers_identity_key_idx" ON "sellers" USING btree ("identity_key");
