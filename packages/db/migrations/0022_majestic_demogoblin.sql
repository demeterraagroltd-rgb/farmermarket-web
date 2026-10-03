ALTER TABLE "warehouse_movements" ADD COLUMN "request_snapshot" jsonb;
--> statement-breakpoint
CREATE FUNCTION preserve_warehouse_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Warehouse movement history is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER warehouse_history_immutable BEFORE UPDATE OR DELETE ON warehouse_movements
FOR EACH ROW EXECUTE FUNCTION preserve_warehouse_history();
--> statement-breakpoint
CREATE FUNCTION check_warehouse_available_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_key uuid; total_available bigint; global_available integer;
BEGIN
 IF TG_TABLE_NAME = 'products' THEN product_key := NEW.id;
 ELSE product_key := COALESCE(NEW.product_id, OLD.product_id); END IF;
 SELECT stock_quantity INTO global_available FROM products WHERE id = product_key;
 SELECT COALESCE(SUM(available),0) INTO total_available FROM warehouse_stocks WHERE product_id = product_key;
 IF total_available > global_available THEN RAISE EXCEPTION 'Warehouse available stock exceeds product total'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER warehouse_available_total AFTER INSERT OR UPDATE OR DELETE ON warehouse_stocks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_warehouse_available_total();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_available_total AFTER UPDATE ON products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_warehouse_available_total();
