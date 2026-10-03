CREATE TABLE "inventory_cost_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"unit_cost_kobo" bigint NOT NULL,
	"reason" text NOT NULL,
	"actor_staff_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_assignments_lot_id_unique" UNIQUE("lot_id"),
	CONSTRAINT "inventory_cost_assignments_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "cost_assignment_nonnegative" CHECK ("inventory_cost_assignments"."unit_cost_kobo">=0)
);
--> statement-breakpoint
CREATE TABLE "inventory_cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_kobo" bigint,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entry_quantity" CHECK ("inventory_cost_entries"."quantity">0),
	CONSTRAINT "cost_entry_kind" CHECK ("inventory_cost_entries"."kind" in ('cogs','stock_loss'))
);
--> statement-breakpoint
CREATE TABLE "inventory_cost_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"product_id" uuid NOT NULL,
	"origin_movement_id" uuid,
	"product_name" text NOT NULL,
	"unit" text NOT NULL,
	"initial_quantity" integer NOT NULL,
	"remaining_quantity" integer NOT NULL,
	"unit_cost_kobo" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_lots_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "inventory_cost_lots_origin_movement_id_unique" UNIQUE("origin_movement_id"),
	CONSTRAINT "cost_lot_quantities" CHECK ("inventory_cost_lots"."initial_quantity">0 AND "inventory_cost_lots"."remaining_quantity">=0 AND "inventory_cost_lots"."remaining_quantity"<="inventory_cost_lots"."initial_quantity"),
	CONSTRAINT "cost_lot_cost" CHECK ("inventory_cost_lots"."unit_cost_kobo" IS NULL OR "inventory_cost_lots"."unit_cost_kobo">=0)
);
--> statement-breakpoint
ALTER TABLE "inventory_cost_assignments" ADD CONSTRAINT "inventory_cost_assignments_lot_id_inventory_cost_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_cost_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_assignments" ADD CONSTRAINT "inventory_cost_assignments_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_entries" ADD CONSTRAINT "inventory_cost_entries_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_entries" ADD CONSTRAINT "inventory_cost_entries_lot_id_inventory_cost_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_cost_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_lots" ADD CONSTRAINT "inventory_cost_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_lots" ADD CONSTRAINT "inventory_cost_lots_origin_movement_id_inventory_movements_id_fk" FOREIGN KEY ("origin_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION reserved_product_units(target uuid) RETURNS bigint LANGUAGE sql AS $$
 SELECT coalesce(sum(quantity),0)::bigint FROM (
  SELECT oi.quantity::bigint AS quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id
  WHERE oi.product_id=target AND oi.bundle_id IS NULL AND o.stock_reserved AND o.status NOT IN ('delivered','cancelled','rejected')
  UNION ALL
  SELECT (component->>'quantity')::bigint * oi.quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id
  CROSS JOIN LATERAL jsonb_array_elements(oi.components) component
  WHERE oi.bundle_id IS NOT NULL AND component->>'productId'=target::text AND o.stock_reserved AND o.status NOT IN ('delivered','cancelled','rejected')
 ) demand;
$$;
--> statement-breakpoint
-- Opening quantities are preserved; their purchase costs remain explicitly unknown.
INSERT INTO inventory_cost_lots(product_id,product_name,unit,initial_quantity,remaining_quantity,source)
 SELECT id,name,unit,(stock_quantity+reserved_product_units(id))::int,(stock_quantity+reserved_product_units(id))::int,'opening_unknown'
 FROM products WHERE stock_quantity+reserved_product_units(id)>0;
--> statement-breakpoint
CREATE INDEX cost_lot_fifo_idx ON inventory_cost_lots(product_id,sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_entry_movement_lot_unique ON inventory_cost_entries(movement_id,lot_id);
--> statement-breakpoint
CREATE FUNCTION cost_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta bigint; before_units bigint; tracked bigint; product_unit text; cost bigint;
 pending bigint; used integer; lot record;
BEGIN
 delta := NEW.available_delta::bigint + NEW.reserved_delta;
 IF delta=0 THEN RETURN NEW; END IF;
 SELECT unit INTO product_unit FROM products WHERE id=NEW.product_id FOR UPDATE;
 before_units := NEW.available_before::bigint + reserved_product_units(NEW.product_id);
 SELECT coalesce(sum(remaining_quantity),0) INTO tracked FROM inventory_cost_lots WHERE product_id=NEW.product_id;
 IF tracked>before_units THEN RAISE EXCEPTION 'Cost quantities disagree with stock; reconcile inventory before posting'; END IF;
 -- Covers a newly imported product that has no opening movement yet.
 IF tracked<before_units THEN
  INSERT INTO inventory_cost_lots(product_id,product_name,unit,initial_quantity,remaining_quantity,source)
  VALUES(NEW.product_id,NEW.product_name,product_unit,(before_units-tracked)::int,(before_units-tracked)::int,'opening_unknown');
 END IF;
 IF delta>0 THEN
  IF NEW.receipt_id IS NOT NULL THEN
   SELECT pol.unit_cost_kobo INTO cost FROM goods_receipt_lines grl
   JOIN purchase_order_lines pol ON pol.id=grl.purchase_order_line_id
   WHERE grl.receipt_id=NEW.receipt_id AND pol.product_id=NEW.product_id AND grl.accepted=delta;
   IF cost IS NULL THEN RAISE EXCEPTION 'Purchase receipt cost could not be matched'; END IF;
  END IF;
  INSERT INTO inventory_cost_lots(product_id,origin_movement_id,product_name,unit,initial_quantity,remaining_quantity,unit_cost_kobo,source)
  VALUES(NEW.product_id,NEW.id,NEW.product_name,product_unit,delta::int,delta::int,cost,CASE WHEN cost IS NULL THEN 'movement_unknown' ELSE 'purchase_receipt' END);
 ELSE
  pending := -delta;
  FOR lot IN SELECT * FROM inventory_cost_lots WHERE product_id=NEW.product_id AND remaining_quantity>0 ORDER BY sequence FOR UPDATE LOOP
   used := least(pending,lot.remaining_quantity)::int;
   INSERT INTO inventory_cost_entries(movement_id,lot_id,quantity,unit_cost_kobo,kind)
   VALUES(NEW.id,lot.id,used,lot.unit_cost_kobo,CASE WHEN NEW.kind='fulfilment' THEN 'cogs' ELSE 'stock_loss' END);
   UPDATE inventory_cost_lots SET remaining_quantity=remaining_quantity-used,version=version+1 WHERE id=lot.id;
   pending := pending-used;
   EXIT WHEN pending=0;
  END LOOP;
  IF pending<>0 THEN RAISE EXCEPTION 'Not enough costed stock quantity'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_movement_costing AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION cost_inventory_movement();
--> statement-breakpoint
CREATE TRIGGER inventory_cost_entries_immutable BEFORE UPDATE OR DELETE ON inventory_cost_entries FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE TRIGGER inventory_cost_assignments_immutable BEFORE UPDATE OR DELETE ON inventory_cost_assignments FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE FUNCTION protect_inventory_cost_lot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cost lots cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['remaining_quantity','unit_cost_kobo','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['remaining_quantity','unit_cost_kobo','version'])
 THEN RAISE EXCEPTION 'Cost lot origin cannot change'; END IF;
 IF NEW.remaining_quantity>OLD.remaining_quantity THEN RAISE EXCEPTION 'Create a new cost lot for received units'; END IF;
 IF NEW.unit_cost_kobo IS DISTINCT FROM OLD.unit_cost_kobo THEN
  IF OLD.unit_cost_kobo IS NOT NULL OR NOT EXISTS(SELECT 1 FROM inventory_cost_assignments WHERE lot_id=NEW.id AND unit_cost_kobo=NEW.unit_cost_kobo)
  THEN RAISE EXCEPTION 'Unknown costs require a recorded assignment; known costs cannot change'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_cost_lot_protected BEFORE UPDATE OR DELETE ON inventory_cost_lots FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_lot();
