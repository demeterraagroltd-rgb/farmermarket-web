CREATE TABLE "pickup_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "delivery_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_center_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_center_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_center_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_center_id_pickup_centers_id_fk" FOREIGN KEY ("pickup_center_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;