CREATE TYPE "public"."order_status" AS ENUM('placed', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"image_url" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_kobo" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'placed' NOT NULL,
	"subtotal_kobo" bigint NOT NULL,
	"delivery_fee_kobo" bigint DEFAULT 0 NOT NULL,
	"service_fee_kobo" bigint DEFAULT 0 NOT NULL,
	"total_kobo" bigint NOT NULL,
	"bnpl_plan_id" uuid NOT NULL,
	"delivery_address" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimated_delivery_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "total_positive" CHECK ("orders"."total_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "repayment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"total_installments" integer NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"amount_paid_kobo" bigint DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amount_positive" CHECK ("repayment_schedules"."amount_kobo" > 0),
	CONSTRAINT "paid_not_over_amount" CHECK ("repayment_schedules"."amount_paid_kobo" <= "repayment_schedules"."amount_kobo")
);
--> statement-breakpoint
CREATE TABLE "repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repayment_schedule_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amount_positive" CHECK ("repayments"."amount_kobo" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bnpl_plan_id_bnpl_plans_id_fk" FOREIGN KEY ("bnpl_plan_id") REFERENCES "public"."bnpl_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_repayment_schedule_id_repayment_schedules_id_fk" FOREIGN KEY ("repayment_schedule_id") REFERENCES "public"."repayment_schedules"("id") ON DELETE no action ON UPDATE no action;