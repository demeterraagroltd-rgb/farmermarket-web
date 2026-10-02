import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { eq } from "drizzle-orm";
import { createDb, categories, brands, products } from "@farmermarket/db";

// Run from the repository root with the existing private environment files.
// No invented prices: entries without a confirmed price remain in the manifest.
const data = JSON.parse(await readFile(new URL("./new-grocery-products.json", import.meta.url), "utf8")) as Array<{
  sku: string; name: string; brand: string; category: string; unit: string;
  priceNaira: number | null; image: string; description: string;
}>;
const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!dbUrl || !process.env.CLOUDINARY_URL) throw new Error("Database and Cloudinary configuration are required.");
cloudinary.config({ secure: true });
const db = createDb(dbUrl);
const result: Array<{ name: string; status: string; id?: string; imageUrl?: string }> = [];
for (const item of data) {
  const [existing] = await db.select().from(products).where(eq(products.sku, item.sku));
  if (existing) { result.push({ name: item.name, status: "already exists", id: existing.id }); continue; }
  const image = await cloudinary.uploader.upload(fileURLToPath(new URL(`../apps/web/public/products/${item.image}`, import.meta.url)), {
    public_id: `farmermarket/products/${item.sku.toLowerCase()}`, overwrite: false,
    resource_type: "image",
  });
  if (item.priceNaira === null) { result.push({ name: item.name, status: "awaiting price; image uploaded", imageUrl: image.secure_url }); continue; }
  const created = await db.transaction(async (tx) => {
    await tx.insert(categories).values({ name: item.category }).onConflictDoNothing();
    await tx.insert(brands).values({ name: item.brand }).onConflictDoNothing();
    const [category] = await tx.select().from(categories).where(eq(categories.name, item.category));
    const [brand] = await tx.select().from(brands).where(eq(brands.name, item.brand));
    const [product] = await tx.insert(products).values({ name: item.name, sku: item.sku, description: item.description,
      imageUrl: image.secure_url, categoryId: category.id, brandId: brand.id, unit: item.unit,
      priceKobo: BigInt(item.priceNaira! * 100), status: "draft", isAvailable: false, stockQuantity: 0,
      tags: ["needs-stock-confirmation", ...(item.unit.includes("carton") || item.unit === "box" ? ["needs-pack-confirmation"] : [])],
    }).returning();
    return product;
  });
  result.push({ name: item.name, status: created.status, id: created.id });
}
await writeFile(new URL("./.grocery-drafts-result.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await db.$client.end();
