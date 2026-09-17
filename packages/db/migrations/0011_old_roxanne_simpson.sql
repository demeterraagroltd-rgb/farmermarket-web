ALTER TABLE "applicant_profiles" ADD COLUMN "identity_lookup" jsonb;--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD COLUMN "identity_lookup_at" timestamp with time zone;