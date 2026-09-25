CREATE TYPE "public"."stock_movement_type" AS ENUM('receive', 'reserve', 'release', 'dispatch', 'return', 'adjust');--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_code" text NOT NULL,
	"quantity_received" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expiry_date" date,
	"unit_cost_kobo" bigint,
	"vendor_id" uuid,
	"note" text,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_lot_code_unique" UNIQUE("lot_code"),
	CONSTRAINT "lot_received_positive" CHECK ("stock_lots"."quantity_received" > 0),
	CONSTRAINT "lot_remaining_in_range" CHECK ("stock_lots"."quantity_remaining" >= 0 AND "stock_lots"."quantity_remaining" <= "stock_lots"."quantity_received")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"type" "stock_movement_type" NOT NULL,
	"on_hand_delta" integer DEFAULT 0 NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"order_id" uuid,
	"reason" text,
	"note" text,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_nonzero" CHECK ("stock_movements"."on_hand_delta" <> 0 OR "stock_movements"."reserved_delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_state" text;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_lots_fifo_idx" ON "stock_lots" USING btree ("product_id","received_at");--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "stock_reserved_in_range" CHECK ("products"."stock_reserved" >= 0 AND "products"."stock_reserved" <= "products"."stock_quantity");--> statement-breakpoint
-- Opening balance: whatever stock admins had typed onto a product before
-- tracking existed becomes one lot, received now, at the product's recorded
-- cost — so Σ lot remaining = stock_quantity holds from the first row.
INSERT INTO "stock_lots" ("product_id", "lot_code", "quantity_received", "quantity_remaining", "unit_cost_kobo", "note")
SELECT "id", 'OPEN-' || upper(left("id"::text, 8)), "stock_quantity", "stock_quantity", "cost_price_kobo", 'Opening balance'
FROM "products" WHERE "stock_quantity" > 0;--> statement-breakpoint
INSERT INTO "stock_movements" ("product_id", "lot_id", "type", "on_hand_delta", "note")
SELECT "product_id", "id", 'receive', "quantity_received", 'Opening balance'
FROM "stock_lots";
