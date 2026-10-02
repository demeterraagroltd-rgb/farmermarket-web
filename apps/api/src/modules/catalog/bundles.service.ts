import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { nairaToKobo } from "@farmermarket/core";
import { bundles, bundleItems, products, type Db, type Tx } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { describeBundle } from "./bundle-pricing";
import type { BundleInput } from "./dto/bundle.dto";

export async function readBundles(db: Db | Tx, publicOnly = false) {
  const rows = await db.select().from(bundles).where(publicOnly ? eq(bundles.active, true) : undefined).orderBy(bundles.createdAt);
  if (!rows.length) return [];
  const items = await db.select({ bundleId: bundleItems.bundleId, quantity: bundleItems.quantity, product: products })
    .from(bundleItems).innerJoin(products, eq(products.id, bundleItems.productId))
    .where(inArray(bundleItems.bundleId, rows.map((b) => b.id))).orderBy(products.name);
  return rows.map((b) => describeBundle(b, items.filter((i) => i.bundleId === b.id)));
}

@Injectable()
export class BundlesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(publicOnly = false) { return readBundles(this.db, publicOnly); }

  async findBySlug(slug: string) {
    const bundle = (await this.list(true)).find((b) => b.slug === slug);
    if (!bundle) throw new NotFoundException("Bundle not found");
    return bundle;
  }

  async save(input: BundleInput, id?: string) {
    return this.db.transaction(async (tx) => {
      if (id) {
        const [existing] = await tx.select().from(bundles).where(eq(bundles.id, id)).for("update");
        if (!existing) throw new NotFoundException("Bundle not found");
      }
      const [duplicate] = await tx.select().from(bundles).where(eq(bundles.slug, input.slug));
      if (duplicate && duplicate.id !== id) throw new BadRequestException("That bundle slug is already used");
      const productRows = input.items.length ? await tx.select().from(products).where(inArray(products.id, input.items.map((i) => i.productId))).orderBy(products.id).for("share") : [];
      if (productRows.length !== input.items.length) throw new BadRequestException("Choose existing products, once per bundle");
      const values = { name: input.name, slug: input.slug, description: input.description,
        imageUrl: input.imageUrl || null, category: input.category, bundlePriceKobo: input.bundlePrice === null ? null : nairaToKobo(input.bundlePrice),
        featured: input.featured, active: input.active, missingProducts: input.missingProducts, pricingNote: input.pricingNote, updatedAt: new Date() };
      const [row] = id ? await tx.update(bundles).set(values).where(eq(bundles.id, id)).returning() : await tx.insert(bundles).values(values).returning();
      const view = describeBundle(row, input.items.map((i) => ({ product: productRows.find((p) => p.id === i.productId)!, quantity: i.quantity })));
      if (input.active && !view.ready) throw new BadRequestException("To publish, add a composite image, resolve missing products, and set a positive bundle price no higher than the combined product price");
      if (id) await tx.delete(bundleItems).where(eq(bundleItems.bundleId, id));
      if (input.items.length) await tx.insert(bundleItems).values(input.items.map((i) => ({ ...i, bundleId: row.id })));
      return view;
    });
  }
}
