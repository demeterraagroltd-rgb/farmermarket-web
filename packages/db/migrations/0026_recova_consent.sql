CREATE TABLE "recova_callbacks" (
	"event_key" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recova_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"purpose" text NOT NULL,
	"bank_code" text NOT NULL,
	"account_last4" text NOT NULL,
	"payload_encrypted" text NOT NULL,
	"approval_url_encrypted" text,
	"schedule_snapshot" jsonb NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"http_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recova_consents_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "recova_consents_reference_unique" UNIQUE("reference"),
	CONSTRAINT "recova_status_valid" CHECK ("recova_consents"."status" in ('draft','submitting','awaiting_consent','processing','active','failed','needs_review','cancelled','expired')),
	CONSTRAINT "recova_purpose_valid" CHECK ("recova_consents"."purpose" in ('Collection','Recovery'))
);
--> statement-breakpoint
ALTER TABLE "recova_callbacks" ADD CONSTRAINT "recova_callbacks_reference_recova_consents_reference_fk" FOREIGN KEY ("reference") REFERENCES "public"."recova_consents"("reference") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recova_consents" ADD CONSTRAINT "recova_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recova_consents" ADD CONSTRAINT "recova_consents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;