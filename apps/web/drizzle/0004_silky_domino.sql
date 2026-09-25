CREATE TABLE "assessment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"trigger" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid,
	"scope_key" text NOT NULL,
	"category" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"version" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"price_type" text NOT NULL,
	"matched_model" text NOT NULL,
	"condition_note" text NOT NULL,
	"source_label" text NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"source_url" text,
	"sample_count" integer DEFAULT 1 NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"change_reason" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "knowledge_used" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "price_reference_used" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "effect_channel" text DEFAULT 'manual-only' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "market_reference_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "market_reference_version" integer;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "market_reference_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_runs" ADD CONSTRAINT "assessment_runs_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_references" ADD CONSTRAINT "market_price_references_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_runs_listing_idx" ON "assessment_runs" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_reference_scope_version_unique" ON "market_price_references" USING btree ("scope_key","version");--> statement-breakpoint
CREATE INDEX "market_reference_listing_idx" ON "market_price_references" USING btree ("listing_id");