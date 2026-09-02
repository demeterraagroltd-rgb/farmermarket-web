CREATE TYPE "public"."kyc_document_kind" AS ENUM('id_card', 'passport', 'drivers_license', 'nin_slip', 'employment_letter', 'payslip', 'utility_bill', 'bank_statement', 'other');--> statement-breakpoint
CREATE TYPE "public"."kyc_document_status" AS ENUM('pending', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'submitted', 'needs_more_info', 'verified');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'pending_approval' BEFORE 'placed';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'rejected' BEFORE 'placed';--> statement-breakpoint
CREATE TABLE "applicant_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"marital_status" text,
	"dependants_count" smallint,
	"bvn_hash" text,
	"bvn_last4" char(4),
	"nin" text,
	"phone" text NOT NULL,
	"email" text,
	"residential_address" jsonb,
	"state_of_origin" text,
	"lga_of_origin" text,
	"next_of_kin" jsonb,
	"employment_type" text,
	"employer" text,
	"job_title" text,
	"net_monthly_salary_kobo" bigint,
	"salary_day" smallint,
	"years_employed" text,
	"bank_name" text,
	"account_last4" char(4),
	"mono_account_id" text,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_note" text,
	"verified_at" timestamp with time zone,
	"verified_by_staff_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "kyc_document_kind" NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"cloudinary_resource_type" text DEFAULT 'image' NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"status" "kyc_document_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_staff_id" uuid
);
--> statement-breakpoint
CREATE TABLE "kyc_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_staff_id" uuid,
	"from_status" "verification_status",
	"to_status" "verification_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_slot" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_verified_by_staff_id_staff_id_fk" FOREIGN KEY ("verified_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_reviewed_by_staff_id_staff_id_fk" FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_events" ADD CONSTRAINT "kyc_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_events" ADD CONSTRAINT "kyc_events_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_staff_id_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;