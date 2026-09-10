ALTER TABLE "applicant_profiles" ADD COLUMN "bank_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD COLUMN "bank_analysis" jsonb;