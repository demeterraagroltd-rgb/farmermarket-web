ALTER TABLE "inventory_movements" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "warehouse_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "warehouse_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "warehouse_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_pickup_centers_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pickup_centers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX purchase_line_product_unique ON purchase_order_lines(purchase_order_id, product_id);
--> statement-breakpoint
CREATE UNIQUE INDEX receipt_line_order_line_unique ON goods_receipt_lines(receipt_id, purchase_order_line_id);
--> statement-breakpoint
CREATE UNIQUE INDEX receipt_delivery_reference_unique ON goods_receipts(purchase_order_id, lower(trim(delivery_reference)));
--> statement-breakpoint
CREATE FUNCTION preserve_goods_receipt_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Posted goods receipts are permanent and cannot be changed or deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goods_receipts_immutable BEFORE UPDATE OR DELETE ON goods_receipts FOR EACH ROW EXECUTE FUNCTION preserve_goods_receipt_history();
--> statement-breakpoint
CREATE TRIGGER goods_receipt_lines_immutable BEFORE UPDATE OR DELETE ON goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION preserve_goods_receipt_history();
--> statement-breakpoint
CREATE FUNCTION protect_purchase_order_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status text;
BEGIN
 IF TG_OP = 'DELETE' THEN parent_id := OLD.purchase_order_id; ELSE parent_id := NEW.purchase_order_id; END IF;
 SELECT status INTO parent_status FROM purchase_orders WHERE id = parent_id FOR SHARE;
 IF parent_status <> 'draft' THEN RAISE EXCEPTION 'Only draft purchase order lines can change'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER purchase_lines_protected BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION protect_purchase_order_lines();
