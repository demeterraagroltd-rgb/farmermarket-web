import { bigint, check, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { products } from "./catalog.js";
import { inventoryMovements } from "./inventory.js";
import { staff } from "./identity.js";

export const inventoryCostLots = pgTable("inventory_cost_lots", {
  id:uuid("id").primaryKey().defaultRandom(),sequence:serial("sequence").notNull().unique(),
  productId:uuid("product_id").notNull().references(()=>products.id),
  originMovementId:uuid("origin_movement_id").unique().references(()=>inventoryMovements.id),
  productName:text("product_name").notNull(),unit:text("unit").notNull(),
  initialQuantity:integer("initial_quantity").notNull(),remainingQuantity:integer("remaining_quantity").notNull(),
  unitCostKobo:bigint("unit_cost_kobo",{mode:"bigint"}),version:integer("version").notNull().default(1),
  source:text("source").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[check("cost_lot_quantities",sql`${t.initialQuantity}>0 AND ${t.remainingQuantity}>=0 AND ${t.remainingQuantity}<=${t.initialQuantity}`),
  check("cost_lot_cost",sql`${t.unitCostKobo} IS NULL OR ${t.unitCostKobo}>=0`)]);

export const inventoryCostEntries = pgTable("inventory_cost_entries", {
  id:uuid("id").primaryKey().defaultRandom(),movementId:uuid("movement_id").notNull().references(()=>inventoryMovements.id),
  lotId:uuid("lot_id").notNull().references(()=>inventoryCostLots.id),quantity:integer("quantity").notNull(),
  unitCostKobo:bigint("unit_cost_kobo",{mode:"bigint"}),kind:text("kind").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[check("cost_entry_quantity",sql`${t.quantity}>0`),check("cost_entry_kind",sql`${t.kind} in ('cogs','stock_loss')`)]);

export const inventoryCostAssignments = pgTable("inventory_cost_assignments", {
  id:uuid("id").primaryKey().defaultRandom(),lotId:uuid("lot_id").notNull().unique().references(()=>inventoryCostLots.id),
  unitCostKobo:bigint("unit_cost_kobo",{mode:"bigint"}).notNull(),reason:text("reason").notNull(),
  actorStaffId:uuid("actor_staff_id").notNull().references(()=>staff.id),operationId:uuid("operation_id").notNull().unique(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[check("cost_assignment_nonnegative",sql`${t.unitCostKobo}>=0`)]);
