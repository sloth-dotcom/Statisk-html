CREATE TABLE "digest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_run_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"kind" text DEFAULT 'daglig' NOT NULL,
	"recipients" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'kører' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"notices_seen" integer DEFAULT 0 NOT NULL,
	"notices_new" integer DEFAULT 0 NOT NULL,
	"notices_updated" integer DEFAULT 0 NOT NULL,
	"api_requests" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'kører' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"score" integer NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"fit" text,
	"concerns" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"matched_keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"matched_cpv" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" text NOT NULL,
	"status" text DEFAULT 'ny' NOT NULL,
	"assigned_to" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" text NOT NULL,
	"notice_version" text NOT NULL,
	"notice_type" text,
	"title" text,
	"description" text,
	"buyer_name" text,
	"buyer_id" text,
	"buyer_region" text,
	"cpv_main" text,
	"cpv_all" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"value_amount" numeric,
	"value_currency" text,
	"published_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"procedure_type" text,
	"source_url" text,
	"raw" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('danish', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(buyer_name, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cpv_codes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"excluded_keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"regions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"notice_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"buyer_allowlist" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"buyer_blocklist" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"min_value" numeric,
	"max_value" numeric,
	"min_score_for_digest" integer DEFAULT 60 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"model" text NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"notices_scored" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'kører' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_scores" ADD CONSTRAINT "notice_scores_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_scores" ADD CONSTRAINT "notice_scores_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digest_items_notice_profile_uq" ON "digest_items" USING btree ("notice_id","profile_id");--> statement-breakpoint
CREATE INDEX "digest_runs_started_at_idx" ON "digest_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ingest_runs_started_at_idx" ON "ingest_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_scores_notice_profile_version_uq" ON "notice_scores" USING btree ("notice_id","profile_id","profile_version");--> statement-breakpoint
CREATE INDEX "notice_scores_score_idx" ON "notice_scores" USING btree ("score");--> statement-breakpoint
CREATE INDEX "notice_scores_profile_idx" ON "notice_scores" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_status_notice_id_uq" ON "notice_status" USING btree ("notice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notices_notice_id_version_uq" ON "notices" USING btree ("notice_id","notice_version");--> statement-breakpoint
CREATE INDEX "notices_published_at_idx" ON "notices" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "notices_deadline_at_idx" ON "notices" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "notices_cpv_main_idx" ON "notices" USING btree ("cpv_main");--> statement-breakpoint
CREATE INDEX "notices_cpv_all_idx" ON "notices" USING gin ("cpv_all");--> statement-breakpoint
CREATE INDEX "notices_search_idx" ON "notices" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "scoring_runs_started_at_idx" ON "scoring_runs" USING btree ("started_at");