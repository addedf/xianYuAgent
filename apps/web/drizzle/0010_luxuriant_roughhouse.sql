CREATE TABLE IF NOT EXISTS "xianyu_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'xianyu' NOT NULL,
	"scope_hash" text NOT NULL,
	"scope_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mode" text DEFAULT 'fresh' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"start_page" integer DEFAULT 1 NOT NULL,
	"requested_pages" integer DEFAULT 1 NOT NULL,
	"completed_pages" integer DEFAULT 0 NOT NULL,
	"failed_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_reason" text,
	"coverage_note" text,
	"result_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xianyu_scan_runs_scope_idx" ON "xianyu_scan_runs" USING btree ("platform","scope_hash","started_at");