CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"model_version" text,
	"risk_level" text NOT NULL,
	"recommended_action" text NOT NULL,
	"total_opportunity" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"assessment_id" uuid,
	"feedback_type" text NOT NULL,
	"final_label" text,
	"reason" text,
	"actual_acquisition_price" numeric(14, 2),
	"knowledge_candidate" jsonb,
	"promotion_status" text DEFAULT 'not-proposed' NOT NULL,
	"created_by" text DEFAULT 'local-user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_type" text NOT NULL,
	"category" text NOT NULL,
	"brand" text,
	"model" text,
	"title" text NOT NULL,
	"current_summary" text NOT NULL,
	"confidence" text DEFAULT 'draft' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"source_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"seller_id" uuid,
	"monitor_task_id" uuid,
	"category" text NOT NULL,
	"brand" text,
	"model" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"region" text,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"image_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_min" numeric(14, 2),
	"price_max" numeric(14, 2),
	"scan_interval_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"watermark" text,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_event_id" uuid,
	"channel" text NOT NULL,
	"recipient_ref" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"response_code" text,
	"error_summary" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_definitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"score_impact" integer NOT NULL,
	"explanation_template" text NOT NULL,
	"change_reason" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"region" text,
	"profile_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"control_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reason" text,
	"changed_by" text DEFAULT 'local-user' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_controls_control_key_unique" UNIQUE("control_key")
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_knowledge_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_monitor_task_id_monitor_tasks_id_fk" FOREIGN KEY ("monitor_task_id") REFERENCES "public"."monitor_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_rule_definitions_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_listing_idx" ON "assessments" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "assessments_action_idx" ON "assessments" USING btree ("recommended_action");--> statement-breakpoint
CREATE INDEX "feedback_listing_idx" ON "feedback_events" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "feedback_promotion_idx" ON "feedback_events" USING btree ("promotion_status");--> statement-breakpoint
CREATE INDEX "knowledge_scope_idx" ON "knowledge_entries" USING btree ("entry_type","category","brand");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_version_unique" ON "knowledge_versions" USING btree ("knowledge_entry_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_platform_external_unique" ON "marketplace_listings" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "listings_first_seen_idx" ON "marketplace_listings" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "marketplace_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_unique" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_version_unique" ON "rule_versions" USING btree ("rule_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_platform_external_unique" ON "sellers" USING btree ("platform","external_id");