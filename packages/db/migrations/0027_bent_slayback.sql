ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "warehouse_movements" DROP CONSTRAINT "warehouse_movements_order_id_orders_id_fk";
