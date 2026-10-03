CREATE TABLE "warehouse_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"warehouse_name" text NOT NULL,
	"kind" text NOT NULL,
	"available_before" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_before" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"event_key" text NOT NULL,
	"operation_id" uuid,
	"reason" text NOT NULL,
	"reference" text,
	"actor_staff_id" uuid,
	"order_id" uuid,
	"inventory_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_movements_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "warehouse_history_nonnegative" CHECK ("warehouse_movements"."available_before" >= 0 AND "warehouse_movements"."available_after" >= 0 AND "warehouse_movements"."reserved_before" >= 0 AND "warehouse_movements"."reserved_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "warehouse_stocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_product_unique" UNIQUE("product_id","warehouse_id"),
	CONSTRAINT "warehouse_stock_nonnegative" CHECK ("warehouse_stocks"."available" >= 0 AND "warehouse_stocks"."reserved" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movement_kind";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_inventory_movement_id_inventory_movements_id_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_history_idx" ON "warehouse_movements" USING btree ("warehouse_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stock_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("stock_warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_kind" CHECK ("inventory_movements"."kind" IN ('opening', 'receive', 'adjustment', 'reservation', 'release', 'fulfilment', 'allocation', 'transfer', 'count'));