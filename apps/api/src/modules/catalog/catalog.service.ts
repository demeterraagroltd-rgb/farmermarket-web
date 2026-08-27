import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { nairaToKobo } from "@farmermarket/core";
import { categories, brands, products, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { CreateCategoryInput, CreateBrandInput, CreateProductInput } from "./dto/catalog.dto";

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Categories
  listCategories() {
    return this.db.select().from(categories).orderBy(categories.sortOrder);
  }
  createCategory(input: CreateCategoryInput) {
    return this.db.insert(categories).values(input).returning().then((r) => r[0]);
  }

  // Brands
  listBrands() {
    return this.db.select().from(brands);
  }
  createBrand(input: CreateBrandInput) {
    return this.db.insert(brands).values(input).returning().then((r) => r[0]);
  }

  // Products — admin sees everything, the public endpoint only published+available.
  listAllProducts() {
    return this.db.select().from(products).orderBy(desc(products.createdAt));
  }

  listPublishedProducts() {
    return this.db
      .select()
      .from(products)
      .where(and(eq(products.status, "published"), eq(products.isAvailable, true)))
      .orderBy(products.sortOrder);
  }

  createProduct(input: CreateProductInput, createdBy: string) {
    return this.db
      .insert(products)
      .values({
        name: input.name,
        description: input.description ?? "",
        imageUrl: input.imageUrl,
        priceKobo: nairaToKobo(input.priceNaira),
        discountPriceKobo:
          input.discountPriceNaira !== undefined ? nairaToKobo(input.discountPriceNaira) : undefined,
        categoryId: input.categoryId,
        brandId: input.brandId,
        unit: input.unit,
        stockQuantity: input.stockQuantity,
        status: "draft",
        createdBy,
      })
      .returning()
      .then((r) => r[0]);
  }

  updateProductStatus(id: string, status: "draft" | "published" | "archived") {
    return this.db
      .update(products)
      .set({ status, publishedAt: status === "published" ? new Date() : undefined, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning()
      .then((r) => r[0]);
  }
}
