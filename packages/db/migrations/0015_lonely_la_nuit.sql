CREATE TYPE "public"."bank_account_status" AS ENUM('active', 'disconnected', 'reauth_required');--> statement-breakpoint
CREATE TYPE "public"."identity_kind" AS ENUM('bvn', 'nin', 'mashup');--> statement-breakpoint
CREATE TYPE "public"."identity_verdict" AS ENUM('match', 'partial', 'mismatch');--> statement-breakpoint
CREATE TYPE "public"."mono_sync_status" AS ENUM('success', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."mono_sync_trigger" AS ENUM('link', 'customer', 'admin', 'webhook', 'system');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mono_account_id" text NOT NULL,
	"institution" text,
	"account_name" text,
	"account_number_last4" char(4),
	"currency" text DEFAULT 'NGN' NOT NULL,
	"account_type" text,
	"balance_kobo" bigint,
	"balance_retrieved_at" timestamp with time zone,
	"status" "bank_account_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_attempt_at" timestamp with time zone,
	"data_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_mono_account_id_unique" UNIQUE("mono_account_id")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"mono_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_id_synthetic" boolean DEFAULT false NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"balance_after_kobo" bigint,
	"provider_category" text,
	"category" text,
	"raw" jsonb,
	"retrieved_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bank_transactions_amount_non_negative" CHECK ("bank_transactions"."amount_kobo" >= 0)
);
--> statement-breakpoint
CREATE TABLE "financial_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"sync_log_id" uuid,
	"version" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL,
	"analysis_version" integer NOT NULL,
	"source" text NOT NULL,
	"months_analysed" integer DEFAULT 0 NOT NULL,
	"transactions_analysed" integer DEFAULT 0 NOT NULL,
	"salary_detected" boolean DEFAULT false NOT NULL,
	"estimated_monthly_income_kobo" bigint,
	"income_confidence" text,
	"salary_regularity" text,
	"employer_name_match" boolean,
	"balance_kobo" bigint,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"analysis" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "identity_kind" NOT NULL,
	"method" text NOT NULL,
	"verdict" "identity_verdict" NOT NULL,
	"live" boolean NOT NULL,
	"name_match" text,
	"date_of_birth_match" boolean,
	"gender_match" boolean,
	"phone_match" boolean,
	"nin_corroborated" boolean,
	"record_name" text,
	"initiated_by_staff_id" uuid,
	"checked_at" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"mono_account_id" text,
	"sync_log_id" uuid,
	"source" text DEFAULT 'mono_income' NOT NULL,
	"monthly_income_kobo" bigint,
	"average_income_kobo" bigint,
	"confidence" text,
	"last_income_description" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mono_raw_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"mono_account_id" text,
	"sync_log_id" uuid,
	"endpoint" text NOT NULL,
	"payload_encrypted" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mono_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"mono_account_id" text,
	"trigger" "mono_sync_trigger" NOT NULL,
	"triggered_by_staff_id" uuid,
	"status" "mono_sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"endpoints" jsonb,
	"transactions_fetched" integer DEFAULT 0 NOT NULL,
	"transactions_inserted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"data_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_summaries" ADD CONSTRAINT "financial_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_summaries" ADD CONSTRAINT "financial_summaries_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_summaries" ADD CONSTRAINT "financial_summaries_sync_log_id_mono_sync_logs_id_fk" FOREIGN KEY ("sync_log_id") REFERENCES "public"."mono_sync_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_initiated_by_staff_id_staff_id_fk" FOREIGN KEY ("initiated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_profiles" ADD CONSTRAINT "income_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_profiles" ADD CONSTRAINT "income_profiles_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_profiles" ADD CONSTRAINT "income_profiles_sync_log_id_mono_sync_logs_id_fk" FOREIGN KEY ("sync_log_id") REFERENCES "public"."mono_sync_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_raw_responses" ADD CONSTRAINT "mono_raw_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_raw_responses" ADD CONSTRAINT "mono_raw_responses_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_raw_responses" ADD CONSTRAINT "mono_raw_responses_sync_log_id_mono_sync_logs_id_fk" FOREIGN KEY ("sync_log_id") REFERENCES "public"."mono_sync_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_sync_logs" ADD CONSTRAINT "mono_sync_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_sync_logs" ADD CONSTRAINT "mono_sync_logs_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_sync_logs" ADD CONSTRAINT "mono_sync_logs_triggered_by_staff_id_staff_id_fk" FOREIGN KEY ("triggered_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_user_idx" ON "bank_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_account_external_uidx" ON "bank_transactions" USING btree ("bank_account_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_user_time_idx" ON "bank_transactions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_time_idx" ON "bank_transactions" USING btree ("bank_account_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_summaries_user_version_uidx" ON "financial_summaries" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "financial_summaries_user_idx" ON "financial_summaries" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "identity_verifications_user_kind_idx" ON "identity_verifications" USING btree ("user_id","kind","checked_at");--> statement-breakpoint
CREATE INDEX "income_profiles_user_idx" ON "income_profiles" USING btree ("user_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "mono_raw_responses_user_idx" ON "mono_raw_responses" USING btree ("user_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "mono_raw_responses_expiry_idx" ON "mono_raw_responses" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mono_sync_logs_user_idx" ON "mono_sync_logs" USING btree ("user_id","started_at");