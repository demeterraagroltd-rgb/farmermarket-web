import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { koboToNaira, nairaToKobo } from "@farmermarket/core";
import { bnplPlans, banners, categories, brands, products, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type {
  CreateCategoryInput,
  CreateBrandInput,
  CreateBannerInput,
  CreateProductInput,
  UpdateProductInput,
} from "./dto/catalog.dto";

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

  // The Flutter app (DemetarraFF) consumes this endpoint and parses it into
  // its existing `FoodItem` model, which expects `price`/`discountPrice` in
  // naira and `category`/`brand` as display names — not the raw kobo/UUID
  // columns. Rather than diverge the shape, this joins the names in and adds
  // the naira fields *alongside* the raw ones, so the web `/marketplace`
  // page (which reads `priceKobo`) keeps working unchanged.
  async listPublishedProducts() {
    const rows = await this.db
      .select()
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(and(eq(products.status, "published"), eq(products.isAvailable, true)))
      .orderBy(products.sortOrder);

    return rows.map((row) => ({
      ...row.products,
      price: koboToNaira(row.products.priceKobo),
      discountPrice:
        row.products.discountPriceKobo !== null
          ? koboToNaira(row.products.discountPriceKobo)
          : null,
      category: row.categories.name,
      brand: row.brands.name,
      brandImagePath: row.brands.imagePath,
    }));
  }

  listActiveBnplPlans() {
    return this.db
      .select()
      .from(bnplPlans)
      .where(eq(bnplPlans.isActive, true))
      .orderBy(bnplPlans.sortOrder);
  }

  // Promo carousel. Public — the Flutter `MockData.brandBanners` moves here.
  async listActiveBanners() {
    const rows = await this.db
      .select()
      .from(banners)
      .leftJoin(categories, eq(banners.categoryId, categories.id))
      .where(eq(banners.isActive, true))
      .orderBy(banners.sortOrder);

    return rows.map((row) => ({
      ...row.banners,
      category: row.categories?.name ?? null,
    }));
  }

  createBanner(input: CreateBannerInput) {
    return this.db
      .insert(banners)
      .values({
        brand: input.brand,
        imagePath: input.imageUrl,
        tagline: input.tagline,
        categoryId: input.categoryId,
        color: input.color,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      })
      .returning()
      .then((r) => r[0]);
  }

  deleteBanner(id: string) {
    return this.db.delete(banners).where(eq(banners.id, id)).returning().then((r) => r[0]);
  }

  private productValues(input: Partial<CreateProductInput>) {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.priceNaira !== undefined ? { priceKobo: nairaToKobo(input.priceNaira) } : {}),
      ...(input.discountPriceNaira !== undefined
        ? { discountPriceKobo: nairaToKobo(input.discountPriceNaira) }
        : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.isPopular !== undefined ? { isPopular: input.isPopular } : {}),
      ...(input.stockQuantity !== undefined ? { stockQuantity: input.stockQuantity } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
  }

  createProduct(input: CreateProductInput, createdBy: string) {
    const status = input.status ?? "draft";
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
        tags: input.tags ?? [],
        isPopular: input.isPopular ?? false,
        stockQuantity: input.stockQuantity,
        sortOrder: input.sortOrder ?? 0,
        status,
        publishedAt: status === "published" ? new Date() : undefined,
        createdBy,
      })
      .returning()
      .then((r) => r[0]);
  }

  updateProduct(id: string, input: UpdateProductInput) {
    const values = this.productValues(input);
    return this.db
      .update(products)
      .set({
        ...values,
        ...(input.status === "published" ? { publishedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
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
