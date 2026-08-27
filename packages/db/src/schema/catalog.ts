import { bigint, boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staff } from "./identity";

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  imagePath: text("image_path"),
  tagline: text("tagline"),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// §5.5 — the API flattens category/brand ids to the `category`/`brand`
// strings the Dart `FoodItem` model already expects, so mobile is unchanged.
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url").notNull(), // CloudFront URL
    priceKobo: bigint("price_kobo", { mode: "bigint" }).notNull(),
    discountPriceKobo: bigint("discount_price_kobo", { mode: "bigint" }),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    unit: text("unit").notNull(), // '50kg bag', '10L gallon'
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    isAvailable: boolean("is_available").notNull().default(true),
    isPopular: boolean("is_popular").notNull().default(false),
    status: text("status").notNull().default("draft"), // 'draft' | 'published' | 'archived'
    sku: text("sku").unique(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    costPriceKobo: bigint("cost_price_kobo", { mode: "bigint" }),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => staff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("price_positive", sql`${table.priceKobo} > 0`),
    check(
      "discount_below_price",
      sql`${table.discountPriceKobo} IS NULL OR ${table.discountPriceKobo} < ${table.priceKobo}`,
    ),
  ],
);

// Promo carousel — `BrandBanner` parity (name, imagePath, tagline, category, color) (§10).
export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  imagePath: text("image_path").notNull(),
  tagline: text("tagline"),
  categoryId: uuid("category_id").references(() => categories.id),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Seeded from the Dart `BnplPlan.allPlans` — Pay Now (0%), Pay Next Salary
// (0%, popular), 2 Months (2%), 3 Months (5%) (§5.7).
export const bnplPlans = pgTable("bnpl_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  durationMonths: integer("duration_months").notNull(),
  interestPercent: integer("interest_percent").notNull().default(0),
  isPopular: boolean("is_popular").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
