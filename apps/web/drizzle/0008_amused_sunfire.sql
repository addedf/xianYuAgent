ALTER TABLE "market_price_references" ADD COLUMN "condition_grade" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_price_references" ADD COLUMN "production_year" integer;--> statement-breakpoint
ALTER TABLE "market_price_references" ADD COLUMN "accessories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "market_price_references" ADD COLUMN "market" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_price_references" ADD COLUMN "market_region" text;