import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { products } from "./catalog.js";

export const bundles = pgTable("bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  category: text("category").notNull().default("Bundles"),
  bundlePriceKobo: bigint("bundle_price_kobo", { mode: "bigint" }),
  featured: boolean("featured").notNull().default(false),
  active: boolean("active").notNull().default(false),
  // Draft seeds expose unresolved mappings instead of inventing product IDs.
  missingProducts: text("missing_products").array().notNull().default(sql`'{}'::text[]`),
  pricingNote: text("pricing_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("bundle_price_positive", sql`${t.bundlePriceKobo} IS NULL OR ${t.bundlePriceKobo} > 0`)]);

export const bundleItems = pgTable("bundle_items", {
  bundleId: uuid("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
}, (t) => [primaryKey({ columns: [t.bundleId, t.productId] }), check("bundle_quantity_positive", sql`${t.quantity} > 0`)]);

export interface OrderComponentSnapshot {
  productId: string;
  name: string;
  imageUrl: string;
  unit: string;
  quantity: number; // Per bundle; multiply by the order line quantity for fulfilment.
  unitPriceKobo: string; // JSON-safe exact money.
}
