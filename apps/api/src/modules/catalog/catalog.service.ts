import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { calculateCatalogPrice, koboToNaira, nairaToKobo } from "@farmermarket/core";
import { bnplPlans, banners, categories, brands, products, inventoryMovements, type Db } from "@farmermarket/db";
import { lockCatalogPricing, readCatalogPricing, saveCatalogPricing } from "./catalog-pricing";
import { importPriceList, importMarketPrices, PRICE_LIST_PRODUCTS } from "./price-list-import";
import { MARKET_PRICE_PRODUCTS } from "./market-price-data";
import type { CatalogPricingInput } from "./dto/catalog.dto";
import { DB } from "../../db/db.module";
import { bundleItems, bundles, pickupCenters, warehouseStocks, orders, orderItems } from '@farmermarket/db';
import type { CreateOrderInput } from '../orders/dto/create-order.dto';
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

  pricing() { return readCatalogPricing(this.db); }
  updatePricing(input: CatalogPricingInput) { return saveCatalogPricing(this.db, input); }
  priceListPreview() { return PRICE_LIST_PRODUCTS; }
  marketPricePreview() { return MARKET_PRICE_PRODUCTS; }
  importMarketPrices(imageBaseUrl: string, staffId: string) { return importMarketPrices(this.db, imageBaseUrl, staffId); }
  importPriceList(imageBaseUrl: string, staffId: string) { return importPriceList(this.db, imageBaseUrl, staffId); }

  cartAvailability(warehouseId:string,items:CreateOrderInput['items']){return this.db.transaction(async tx=>{
    const [location]=await tx.select().from(pickupCenters).where(eq(pickupCenters.id,warehouseId));
    if(!location?.isActive)throw new BadRequestException('That pickup location is unavailable');
    const bundleIds=items.flatMap(i=>i.bundleId?[i.bundleId]:[]);
    const definitions=bundleIds.length?await tx.select().from(bundles).where(inArray(bundles.id,bundleIds)):[];
    const components=bundleIds.length?await tx.select().from(bundleItems).where(inArray(bundleItems.bundleId,bundleIds)):[];
    const ids=[...new Set([...items.flatMap(i=>i.productId?[i.productId]:[]),...components.map(c=>c.productId)])];
    const catalog=ids.length?await tx.select().from(products).where(inArray(products.id,ids)):[];
    const stock=await tx.select().from(warehouseStocks).where(eq(warehouseStocks.warehouseId,warehouseId));
    const demand=new Map<string,number>();const add=(id:string,n:number)=>demand.set(id,(demand.get(id)??0)+n);
    const issues:string[]=[];
    for(const item of items){if(item.productId)add(item.productId,item.quantity);else{
      const b=definitions.find(b=>b.id===item.bundleId);const included=components.filter(c=>c.bundleId===item.bundleId);
      if(!b?.active||!included.length||b.missingProducts.length)issues.push('A selected bundle is unavailable');
      for(const c of included)add(c.productId,c.quantity*item.quantity);
    }}
    const shortages=[...demand].flatMap(([id,required])=>{const p=catalog.find(p=>p.id===id);const available=p?.status==='published'&&p.isAvailable?(stock.find(b=>b.productId===id)?.available??0):0;return available<required?[{productId:id,name:p?.name??'Unavailable product',required,available}]:[];});
    return {warehouseId,warehouseName:location.name,available:!issues.length&&!shortages.length,issues,shortages};
  },{isolationLevel:'repeatable read'});}

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
      ...this.publicProduct(row.products),
      isAvailable: row.products.isAvailable && row.products.stockQuantity > 0,
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
      .where(and(eq(bnplPlans.isActive, true), eq(bnplPlans.testOnly, false)))
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

  private publicProduct(product: typeof products.$inferSelect) {
    const { costPriceKobo, pricingMode, ...visible } = product;
    return visible;
  }

  private priceValues(input: Partial<CreateProductInput>, rates: CatalogPricingInput, existing?: typeof products.$inferSelect) {
    const pricingMode = input.pricingMode ?? existing?.pricingMode ?? "manual";
    const costPriceKobo = input.costPriceNaira !== undefined ? nairaToKobo(input.costPriceNaira) : existing?.costPriceKobo ?? null;
    if (pricingMode === "percentage") {
      if (!costPriceKobo || costPriceKobo <= 0n) throw new BadRequestException("Enter a positive cost price for percentage pricing");
      if (input.discountPriceNaira != null) throw new BadRequestException("Percentage pricing uses the calculated total. Switch to manual pricing to set a discount.");
      return { pricingMode, costPriceKobo, priceKobo: calculateCatalogPrice(costPriceKobo, rates).priceKobo, discountPriceKobo: null };
    }
    const priceKobo = input.priceNaira !== undefined ? nairaToKobo(input.priceNaira) : existing?.priceKobo;
    const discountPriceKobo = input.discountPriceNaira === null ? null : input.discountPriceNaira !== undefined ? nairaToKobo(input.discountPriceNaira) : existing?.discountPriceKobo ?? null;
    if (!priceKobo || priceKobo <= 0n) throw new BadRequestException("Enter a positive selling price");
    if (discountPriceKobo !== null && (discountPriceKobo <= 0n || discountPriceKobo >= priceKobo)) throw new BadRequestException("Discount must be positive and below the selling price");
    return { pricingMode, costPriceKobo, priceKobo, discountPriceKobo };
  }

  private productValues(input: Partial<CreateProductInput>) {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
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

  async createProduct(input: CreateProductInput, createdBy: string) {
    const status = input.status ?? "draft";
    return this.db.transaction(async (tx) => {
    const rates = await lockCatalogPricing(tx);
    const pricing = this.priceValues(input, rates);
    const [product] = await tx
      .insert(products)
      .values({
        name: input.name,
        description: input.description ?? "",
        imageUrl: input.imageUrl,
        ...pricing,
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
      .returning();
    await tx.insert(inventoryMovements).values({ productId: product.id, productName: product.name, kind: "opening",
      availableDelta: product.stockQuantity, availableBefore: 0, availableAfter: product.stockQuantity,
      reason: "Initial stock on product creation", actorStaffId: createdBy, eventKey: `opening:${product.id}` });
    return product;
    });
  }

  updateProduct(id: string, input: UpdateProductInput) {
    if (input.stockQuantity !== undefined) throw new BadRequestException("Use Inventory to receive or adjust stock with a reason");
    const values = this.productValues(input);
    return this.db.transaction(async tx=>{
    const rates = await lockCatalogPricing(tx);
    const [p]=await tx.select().from(products).where(eq(products.id,id)).for('update');
    if (!p) throw new BadRequestException('Product not found');
    const pricing = this.priceValues(input, rates, p);
    if(p&&input.unit!==undefined&&input.unit!==p.unit){
      const [history]=await tx.select({id:inventoryMovements.id}).from(inventoryMovements).where(and(eq(inventoryMovements.productId,id),sql`(${inventoryMovements.availableDelta} <> 0 OR ${inventoryMovements.reservedDelta} <> 0)`)).limit(1);
      const [reserved]=await tx.select({id:orderItems.id}).from(orderItems).innerJoin(orders,eq(orderItems.orderId,orders.id)).where(and(eq(orders.stockReserved,true),sql`(${orderItems.productId} = ${id}::uuid OR ${orderItems.components} @> ${JSON.stringify([{productId:id}])}::jsonb)`)).limit(1);
      if(history||reserved||p.stockQuantity>0)throw new BadRequestException('Stock units cannot change after stock has been recorded. Create a separate product for a different sale unit.');
    }
    return tx
      .update(products)
      .set({
        ...values,
        ...pricing,
        ...(input.status === "published" ? { publishedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning()
      .then((r) => r[0]);
    });
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
