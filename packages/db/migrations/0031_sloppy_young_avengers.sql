CREATE TABLE "recova_payment_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"channel" text NOT NULL,
	"source_name" text NOT NULL,
	"transaction_reference" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'needs_verification' NOT NULL,
	"reported_by_staff_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_by_staff_id" uuid,
	"dismissed_at" timestamp with time zone,
	"dismissal_reason" text,
	CONSTRAINT "recova_report_amount_positive" CHECK ("recova_payment_reports"."amount_kobo" > 0),
	CONSTRAINT "recova_report_status_valid" CHECK ("recova_payment_reports"."status" in ('needs_verification','dismissed')),
	CONSTRAINT "recova_report_channel_valid" CHECK ("recova_payment_reports"."channel" in ('collection','recovery','voluntary'))
);
--> statement-breakpoint
ALTER TABLE "recova_payment_reports" ADD CONSTRAINT "recova_payment_reports_reference_recova_consents_reference_fk" FOREIGN KEY ("reference") REFERENCES "public"."recova_consents"("reference") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recova_payment_reports" ADD CONSTRAINT "recova_payment_reports_reported_by_staff_id_staff_id_fk" FOREIGN KEY ("reported_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recova_payment_reports" ADD CONSTRAINT "recova_payment_reports_dismissed_by_staff_id_staff_id_fk" FOREIGN KEY ("dismissed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recova_report_source_transaction_unique" ON "recova_payment_reports" USING btree ("source_name","transaction_reference") WHERE "recova_payment_reports"."status" = 'needs_verification';
