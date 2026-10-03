import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { products } from './catalog.js';
import { pickupCenters, orders } from './commerce.js';
import { staff } from './identity.js';
import { inventoryMovements } from './inventory.js';

export const warehouseStocks = pgTable('warehouse_stocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(()=>products.id),
  warehouseId: uuid('warehouse_id').notNull().references(()=>pickupCenters.id),
  available: integer('available').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('warehouse_product_unique').on(t.productId,t.warehouseId),check('warehouse_stock_nonnegative',sql`${t.available} >= 0 AND ${t.reserved} >= 0`)]);

export const warehouseMovements = pgTable('warehouse_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(()=>products.id),
  productName: text('product_name').notNull(),
  unit: text('unit').notNull(),
  warehouseId: uuid('warehouse_id').notNull().references(()=>pickupCenters.id),
  warehouseName: text('warehouse_name').notNull(),
  kind: text('kind').notNull(),
  availableBefore: integer('available_before').notNull(),
  availableAfter: integer('available_after').notNull(),
  reservedBefore: integer('reserved_before').notNull(),
  reservedAfter: integer('reserved_after').notNull(),
  eventKey: text('event_key').notNull().unique(),
  operationId: uuid('operation_id'),
  requestSnapshot: jsonb('request_snapshot').$type<Record<string,unknown>>(),
  reason: text('reason').notNull(),
  reference: text('reference'),
  actorStaffId: uuid('actor_staff_id').references(()=>staff.id),
  orderId: uuid('order_id').references(()=>orders.id),
  inventoryMovementId: uuid('inventory_movement_id').references(()=>inventoryMovements.id),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('warehouse_history_idx').on(t.warehouseId,t.createdAt),check('warehouse_history_nonnegative',sql`${t.availableBefore} >= 0 AND ${t.availableAfter} >= 0 AND ${t.reservedBefore} >= 0 AND ${t.reservedAfter} >= 0`)]);
