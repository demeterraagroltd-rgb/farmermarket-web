CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"kind" text NOT NULL,
	"available_delta" integer NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"available_before" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"actor_staff_id" uuid,
	"order_id" uuid,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "inventory_available_nonnegative" CHECK ("inventory_movements"."available_before" >= 0 AND "inventory_movements"."available_after" >= 0),
	CONSTRAINT "inventory_movement_balanced" CHECK ("inventory_movements"."available_after" = "inventory_movements"."available_before" + "inventory_movements"."available_delta"),
	CONSTRAINT "inventory_movement_kind" CHECK ("inventory_movements"."kind" IN ('opening', 'receive', 'adjustment', 'reservation', 'release', 'fulfilment'))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_product_date_idx" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_stock_nonnegative" CHECK ("products"."stock_quantity" >= 0);
--> statement-breakpoint
INSERT INTO inventory_movements (product_id, product_name, kind, available_delta, available_before, available_after, reason, actor_staff_id, event_key)
SELECT id, name, 'opening', stock_quantity, 0, stock_quantity, 'Opening available balance when inventory tracking enabled', created_by, 'opening:' || id::text FROM products;
--> statement-breakpoint
CREATE FUNCTION preserve_inventory_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory history is permanent; create a correcting movement instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_history_immutable BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION preserve_inventory_history();
