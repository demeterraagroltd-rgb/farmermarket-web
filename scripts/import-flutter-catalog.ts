/**
 * One-off: move the Flutter app's hardcoded catalog into the database and its
 * bundled images onto Cloudinary, so both apps read one source of truth.
 *
 * Mirrors `DemetarraFF/lib/shared/mock/mock_data.dart` — 2 categories,
 * 4 brands, 10 products, 3 promo banners — plus `config/fees` and the four
 * BNPL plans.
 *
 * Idempotent: re-running skips existing Cloudinary assets and upserts rows by
 * their natural key (category/brand/banner name, product name).
 *
 * Env:
 *   DATABASE_URL         required — target Postgres (prod: Render connection string)
 *   CLOUDINARY_URL       required — cloudinary://<key>:<secret>@<cloud>
 *   FLUTTER_ASSETS_DIR   optional — defaults to the sibling Flutter repo's assets/Images
 *
 * Run: pnpm import:catalog
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { eq } from "drizzle-orm";
import { nairaToKobo } from "@farmermarket/core";
import {
  createDb,
  bnplPlans,
  banners,
  brands,
  categories,
  config,
  products,
} from "@farmermarket/db";

const ASSETS_DIR =
  process.env.FLUTTER_ASSETS_DIR ?? "C:\\My Projects\\DemetarraFF\\assets\\Images";
const CLOUD_FOLDER = "farmer-market/catalog";
const MAP_FILE = join(__dirname, ".cloudinary-map.json");

// ─── Source data (mirrors mock_data.dart) ────────────────────────────────────

const CATEGORY_DATA = [
  { name: "Rice", sortOrder: 0 },
  { name: "Cooking Oil", sortOrder: 1 },
];

// color is the Flutter 0xFF__ int → stored as #RRGGBB hex.
const BRAND_DATA = [
  { name: "Big Bull", image: "Big Bull Brand Image.jpg", tagline: "Nigeria's Favourite Rice", color: 0xff1a7a4c },
  { name: "Kings Oil", image: "Kings Oil brand image.jpg", tagline: "Pure. Healthy. Trusted.", color: 0xfff5a623 },
  { name: "Mamador", image: "Mamador Brand Image.jfif", tagline: "The Cooking Oil of Choice", color: 0xff1a7a4c },
  { name: "Power Oil", image: null, tagline: null, color: null },
];

const BANNER_DATA = [
  { brand: "Big Bull", image: "Big Bull Brand Image.jpg", tagline: "Nigeria's Favourite Rice", category: "Rice", color: 0xff1a7a4c, sortOrder: 0 },
  { brand: "Kings Oil", image: "Kings Oil brand image.jpg", tagline: "Pure. Healthy. Trusted.", category: "Cooking Oil", color: 0xfff5a623, sortOrder: 1 },
  { brand: "Mamador", image: "Mamador Brand Image.jfif", tagline: "The Cooking Oil of Choice", category: "Cooking Oil", color: 0xff1a7a4c, sortOrder: 2 },
];

type ProductSeed = {
  name: string;
  description: string;
  image: string;
  priceNaira: number;
  category: string;
  brand: string;
  unit: string;
  isPopular: boolean;
  tags: string[];
};

const PRODUCT_DATA: ProductSeed[] = [
  { name: "Big Bull Rice 50kg", image: "big-bull-rice-50kg.jpg", priceNaira: 58000, category: "Rice", brand: "Big Bull", unit: "50kg bag", isPopular: true, tags: ["rice", "big bull", "50kg", "family"], description: "Nigeria's most trusted parboiled rice. Long grain, stone-free, and perfectly milled. A full 50kg bag that feeds a family of 6 for an entire month." },
  { name: "Big Bull Rice 15kg", image: "Big bull 15kg.jfif", priceNaira: 17400, category: "Rice", brand: "Big Bull", unit: "15kg bag", isPopular: false, tags: ["rice", "big bull", "15kg"], description: "Same premium Big Bull quality in a 15kg bag. Ideal for smaller households or to top up your monthly supply." },
  { name: "Big Bull Rice 10kg", image: "big bull 10kg.webp", priceNaira: 11600, category: "Rice", brand: "Big Bull", unit: "10kg bag", isPopular: false, tags: ["rice", "big bull", "10kg"], description: "Compact 10kg bag of Big Bull premium parboiled rice. Perfect for a small family or a week's supply." },
  { name: "Big Bull Rice 750g", image: "big bull 750g.webp", priceNaira: 870, category: "Rice", brand: "Big Bull", unit: "750g pack", isPopular: false, tags: ["rice", "big bull", "small", "trial"], description: "Convenient 750g pack of Big Bull parboiled rice. Great for trying the brand or for a single-meal pack." },
  { name: "Kings Oil 10L", image: "Kings Oil 10L.jfif", priceNaira: 16000, category: "Cooking Oil", brand: "Kings Oil", unit: "10L gallon", isPopular: true, tags: ["oil", "kings oil", "10L", "vegetable oil"], description: "Premium refined vegetable oil in a 10-litre sealed gallon. Clean, cholesterol-free, and perfect for all Nigerian cooking — frying, stewing, and soups." },
  { name: "Kings Oil 1L", image: "Kings Oil 1L.jfif", priceNaira: 1800, category: "Cooking Oil", brand: "Kings Oil", unit: "1L bottle", isPopular: false, tags: ["oil", "kings oil", "1L", "small"], description: "Kings Oil refined vegetable cooking oil in a 1-litre bottle. Ideal for daily use or as a top-up between larger purchases." },
  { name: "Mamador Oil 3.5L", image: "Mamador-Groundnut-Vegetable-Cooking-Oil-3.5L-1-1.webp", priceNaira: 5500, category: "Cooking Oil", brand: "Mamador", unit: "3.5L bottle", isPopular: false, tags: ["oil", "mamador", "3.5L", "groundnut"], description: "Mamador premium groundnut vegetable oil — light, flavourful, and ideal for everyday cooking. The 3.5-litre bottle is a household favourite." },
  { name: "Mamador Oil 500ml", image: "Mamador Vegetable Oil 500ml.webp", priceNaira: 950, category: "Cooking Oil", brand: "Mamador", unit: "500ml bottle", isPopular: false, tags: ["oil", "mamador", "500ml", "small"], description: "Mamador groundnut vegetable oil in a convenient 500ml bottle. Perfect for small kitchens or trying Mamador for the first time." },
  { name: "Power Oil 50L Jerry Can", image: "Power Oil Jerry can 50Lts.jfif", priceNaira: 72000, category: "Cooking Oil", brand: "Power Oil", unit: "50L jerry can", isPopular: false, tags: ["oil", "power oil", "50L", "bulk", "jerry can"], description: "Bulk 50-litre Power Oil jerry can — ideal for large families, canteens, and businesses. Refined vegetable oil, sealed for freshness." },
  { name: "Power Oil 5L", image: "Power Oil 5lts.jfif", priceNaira: 7500, category: "Cooking Oil", brand: "Power Oil", unit: "5L gallon", isPopular: false, tags: ["oil", "power oil", "5L", "vegetable oil"], description: "Power Oil refined vegetable oil in a 5-litre container. Great for a month's cooking for a small-to-medium household." },
];

const BNPL_PLANS = [
  { name: "Pay Now", durationMonths: 0, interestPercent: 0, isPopular: false, sortOrder: 0 },
  { name: "Pay Next Salary", durationMonths: 1, interestPercent: 0, isPopular: true, sortOrder: 1 },
  { name: "Pay Over 2 Months", durationMonths: 2, interestPercent: 2, isPopular: false, sortOrder: 2 },
  { name: "Pay Over 3 Months", durationMonths: 3, interestPercent: 5, isPopular: false, sortOrder: 3 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexColor(int: number | null): string | undefined {
  if (int === null) return undefined;
  return `#${(int & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

function slug(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uploadImage(filename: string, urlMap: Record<string, string>): Promise<string> {
  if (urlMap[filename]) return urlMap[filename];
  const path = join(ASSETS_DIR, filename);
  if (!existsSync(path)) throw new Error(`Image not found: ${path}`);
  const publicId = `${CLOUD_FOLDER}/${slug(filename)}`;
  const res = await cloudinary.uploader.upload(path, {
    public_id: publicId,
    overwrite: false,
    unique_filename: false,
    use_filename: false,
    resource_type: "image",
  });
  urlMap[filename] = res.secure_url;
  console.log(`  ✓ ${filename} → ${res.secure_url}`);
  return res.secure_url;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  if (!process.env.CLOUDINARY_URL) throw new Error("CLOUDINARY_URL is not set");
  cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from env

  const db = createDb(dbUrl);
  const urlMap: Record<string, string> = existsSync(MAP_FILE)
    ? JSON.parse(readFileSync(MAP_FILE, "utf8"))
    : {};

  // 1. Images
  console.log("Uploading images to Cloudinary…");
  const allFiles = [
    ...new Set([
      ...BRAND_DATA.map((b) => b.image),
      ...BANNER_DATA.map((b) => b.image),
      ...PRODUCT_DATA.map((p) => p.image),
    ]),
  ].filter((f): f is string => !!f);
  for (const file of allFiles) await uploadImage(file, urlMap);
  writeFileSync(MAP_FILE, JSON.stringify(urlMap, null, 2));

  // 2. Categories
  console.log("Upserting categories…");
  for (const c of CATEGORY_DATA) {
    await db.insert(categories).values(c).onConflictDoNothing({ target: categories.name });
  }
  const categoryRows = await db.select().from(categories);
  const categoryId = (name: string) => {
    const row = categoryRows.find((c) => c.name === name);
    if (!row) throw new Error(`Category not found after upsert: ${name}`);
    return row.id;
  };

  // 3. Brands
  console.log("Upserting brands…");
  for (const b of BRAND_DATA) {
    const imagePath = b.image ? urlMap[b.image] : undefined;
    // Only carry keys that actually have a value — a brand like "Power Oil"
    // has no image/tagline/colour, which would leave an all-undefined `set`
    // and make drizzle throw "No values to set".
    const set: Record<string, unknown> = {};
    if (imagePath !== undefined) set.imagePath = imagePath;
    if (b.tagline != null) set.tagline = b.tagline;
    const color = hexColor(b.color);
    if (color !== undefined) set.color = color;

    const insert = db.insert(brands).values({ name: b.name, imagePath, tagline: b.tagline ?? undefined, color });
    await (Object.keys(set).length > 0
      ? insert.onConflictDoUpdate({ target: brands.name, set })
      : insert.onConflictDoNothing({ target: brands.name }));
  }
  const brandRows = await db.select().from(brands);
  const brandId = (name: string) => {
    const row = brandRows.find((b) => b.name === name);
    if (!row) throw new Error(`Brand not found after upsert: ${name}`);
    return row.id;
  };

  // 4. Products
  console.log("Upserting products…");
  let sortOrder = 0;
  for (const p of PRODUCT_DATA) {
    const values = {
      name: p.name,
      description: p.description,
      imageUrl: urlMap[p.image],
      priceKobo: nairaToKobo(p.priceNaira),
      categoryId: categoryId(p.category),
      brandId: brandId(p.brand),
      unit: p.unit,
      tags: p.tags,
      isPopular: p.isPopular,
      isAvailable: true,
      stockQuantity: 100,
      status: "published" as const,
      sortOrder: sortOrder++,
      publishedAt: new Date(),
      updatedAt: new Date(),
    };
    const [existing] = await db.select().from(products).where(eq(products.name, p.name)).limit(1);
    if (existing) {
      await db.update(products).set(values).where(eq(products.id, existing.id));
    } else {
      await db.insert(products).values(values);
    }
  }

  // 5. Banners
  console.log("Upserting banners…");
  const existingBanners = await db.select().from(banners);
  for (const b of BANNER_DATA) {
    const values = {
      brand: b.brand,
      imagePath: urlMap[b.image],
      tagline: b.tagline,
      categoryId: categoryId(b.category),
      color: hexColor(b.color),
      sortOrder: b.sortOrder,
      isActive: true,
    };
    const existing = existingBanners.find((row) => row.brand === b.brand);
    if (existing) {
      await db.update(banners).set(values).where(eq(banners.id, existing.id));
    } else {
      await db.insert(banners).values(values);
    }
  }

  // 6. BNPL plans (only if the table is empty — prod currently returns [])
  const planCount = await db.select().from(bnplPlans);
  if (planCount.length === 0) {
    console.log("Seeding BNPL plans…");
    for (const plan of BNPL_PLANS) await db.insert(bnplPlans).values(plan);
  }

  // 7. Fees config
  console.log("Upserting config/fees…");
  await db
    .insert(config)
    .values({ key: "fees", value: { deliveryFeeKobo: 150000, serviceFeePercent: 3 } })
    .onConflictDoUpdate({
      target: config.key,
      set: { value: { deliveryFeeKobo: 150000, serviceFeePercent: 3 }, updatedAt: new Date() },
    });

  console.log(
    `\nDone. ${CATEGORY_DATA.length} categories, ${BRAND_DATA.length} brands, ` +
      `${PRODUCT_DATA.length} products, ${BANNER_DATA.length} banners, ` +
      `${planCount.length === 0 ? BNPL_PLANS.length : 0} plans seeded.`,
  );
  console.log(`Cloudinary URL map written to ${MAP_FILE}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
