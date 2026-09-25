CREATE TYPE "public"."debit_attempt_status" AS ENUM('initiated', 'processing', 'successful', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."debit_mandate_status" AS ENUM('awaiting_authorisation', 'approved', 'active', 'paused', 'cancelled', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "debit_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repayment_schedule_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"reference" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"status" "debit_attempt_status" DEFAULT 'initiated' NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"provider_reference" text,
	"response_code" text,
	"failure_reason" text,
	"fee_kobo" bigint,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"repayment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_attempts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "debit_attempts_amount_positive" CHECK ("debit_attempts"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "debit_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"mono_customer_id" text NOT NULL,
	"mono_mandate_id" text,
	"reference" text NOT NULL,
	"status" "debit_mandate_status" DEFAULT 'awaiting_authorisation' NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"collected_kobo" bigint DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"authorisation_url" text,
	"status_reason" text,
	"approved_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_mandates_mono_mandate_id_unique" UNIQUE("mono_mandate_id"),
	CONSTRAINT "debit_mandates_reference_unique" UNIQUE("reference"),
	CONSTRAINT "debit_mandates_amount_positive" CHECK ("debit_mandates"."amount_kobo" > 0),
	CONSTRAINT "debit_mandates_collected_within_cap" CHECK ("debit_mandates"."collected_kobo" >= 0 AND "debit_mandates"."collected_kobo" <= "debit_mandates"."amount_kobo")
);
--> statement-breakpoint
CREATE TABLE "mono_customers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mono_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mono_customers_mono_customer_id_unique" UNIQUE("mono_customer_id")
);
--> statement-breakpoint
ALTER TABLE "debit_attempts" ADD CONSTRAINT "debit_attempts_repayment_schedule_id_repayment_schedules_id_fk" FOREIGN KEY ("repayment_schedule_id") REFERENCES "public"."repayment_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_attempts" ADD CONSTRAINT "debit_attempts_mandate_id_debit_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."debit_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_attempts" ADD CONSTRAINT "debit_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_attempts" ADD CONSTRAINT "debit_attempts_repayment_id_repayments_id_fk" FOREIGN KEY ("repayment_id") REFERENCES "public"."repayments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_mandates" ADD CONSTRAINT "debit_mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_mandates" ADD CONSTRAINT "debit_mandates_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mono_customers" ADD CONSTRAINT "mono_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debit_attempts_one_open_per_schedule" ON "debit_attempts" USING btree ("repayment_schedule_id") WHERE "debit_attempts"."status" in ('initiated', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "debit_attempts_repayment_uidx" ON "debit_attempts" USING btree ("repayment_id") WHERE "debit_attempts"."repayment_id" is not null;--> statement-breakpoint
CREATE INDEX "debit_attempts_schedule_idx" ON "debit_attempts" USING btree ("repayment_schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "debit_attempts_user_idx" ON "debit_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "debit_mandates_one_live_per_user" ON "debit_mandates" USING btree ("user_id") WHERE "debit_mandates"."status" in ('awaiting_authorisation', 'approved', 'active', 'paused');--> statement-breakpoint
CREATE INDEX "debit_mandates_user_idx" ON "debit_mandates" USING btree ("user_id","created_at");