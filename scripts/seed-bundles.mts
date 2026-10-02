import { createDb, products, bundles, bundleItems } from "@farmermarket/db";
import { eq } from "drizzle-orm";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = createDb(process.env.DATABASE_URL);
const definitions = [
  { name: "Family Kitchen Bundle", slug: "family-kitchen-bundle", description: "Rice, cooking oil, noodles and tomato mix for everyday family meals.", mappings: ["rice", "oil", "noodles", "tomato"] },
  { name: "Essential Food Bundle", slug: "essential-food-bundle", description: "Rice, semovita and cooking oil for your kitchen staples.", mappings: ["rice", "semovita", "oil"] },
  { name: "Quick Meal Bundle", slug: "quick-meal-bundle", description: "Noodles, cooking oil and tomato mix for quick meals.", mappings: ["noodles", "oil", "tomato"] },
  { name: "Monthly Grocery Bundle", slug: "monthly-grocery-bundle", description: "Rice, semovita, cooking oil, noodles and tomato mix in one grocery purchase.", mappings: ["rice", "semovita", "oil", "noodles", "tomato"] },
];
try {
  const catalog = await db.select().from(products);
  const mapped = {
    rice: catalog.find((p) => /big bull/i.test(p.name) && /10\s*kg/i.test(p.name)),
    oil: catalog.find((p) => /kings/i.test(p.name) && /1\s*l\b/i.test(p.name)),
    noodles: catalog.find((p) => p.sku === "FM-INDOMIE-REGULAR-CHICKEN"),
    tomato: catalog.find((p) => p.sku === "FM-TASTY-TOM-BOX"),
    semovita: catalog.find((p) => p.sku === "FM-SEMOVITA-10KG"),
    seasoning: catalog.find((p) => /maggi/i.test(p.name)),
  };
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(bundles).where(eq(bundles.slug, definition.slug));
      if (existing) { console.log(`Preserved existing bundle: ${existing.name}`); return; }
      const keys = [...definition.mappings, "seasoning"] as (keyof typeof mapped)[];
      const included = keys.flatMap((key) => mapped[key] ? [mapped[key]!] : []);
      const missing = keys.filter((key) => !mapped[key]).map((key) => key === "seasoning" ? "Maggi / seasoning" : key);
      const regularKobo = included.reduce((sum, p) => sum + (p.discountPriceKobo ?? p.priceKobo), 0n);
      // User-authorized provisional 5% discount, rounded DOWN to the nearest ₦100.
      const priceKobo = (regularKobo * 95n / 100n / 10000n) * 10000n;
      const [bundle] = await tx.insert(bundles).values({ name: definition.name, slug: definition.slug, description: definition.description, bundlePriceKobo: priceKobo > 0n ? priceKobo : null,
        featured: index < 3, active: false, missingProducts: missing,
        pricingNote: "Provisional: about 5% off mapped products, rounded down to ₦100. Missing products are excluded from this draft price. Review after adding them; upload a composite image before publishing." }).returning();
      if (included.length) await tx.insert(bundleItems).values(included.map((p) => ({ bundleId: bundle.id, productId: p.id, quantity: 1 })));
      console.log(JSON.stringify({ name: bundle.name, draftPriceNaira: Number(priceKobo) / 100, products: included.map((p) => p.name), missingProducts: missing, active: false }));
    });
  }
} finally { await db.$client.end(); }
