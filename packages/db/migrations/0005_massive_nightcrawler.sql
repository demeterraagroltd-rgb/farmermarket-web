ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deactivated_by_staff_id_staff_id_fk" FOREIGN KEY ("deactivated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;