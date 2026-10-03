import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createOrderItemSchema, type CreateOrderInput } from '../orders/dto/create-order.dto';
const availabilitySchema=z.object({warehouseId:z.string().uuid(),items:z.array(createOrderItemSchema).min(1).max(100)});
import { ApiTags } from "@nestjs/swagger";
import { BundlesService } from "./bundles.service";
import { CatalogService } from "./catalog.service";

// Public — no auth. Consumed by the public web `/marketplace` page and by
// the Flutter app's `MarketplaceRepository` / `CheckoutRepository` (§10, §14).
@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService, private readonly bundlesService: BundlesService) {}
  @Post('availability') availability(@Body(new ZodValidationPipe(availabilitySchema)) input:{warehouseId:string;items:CreateOrderInput['items']}){return this.catalogService.cartAvailability(input.warehouseId,input.items);}

  @Get("bundles")
  listBundles() { return this.bundlesService.list(true); }

  @Get("bundles/:slug")
  getBundle(@Param("slug") slug: string) { return this.bundlesService.findBySlug(slug); }

  // GET /v1/catalog/products — the published+available filter is fixed in the
  // service (there's only one public view), so no query params are needed.
  @Get("products")
  listProducts() {
    return this.catalogService.listPublishedProducts();
  }

  // Filter chips in the phone app's marketplace ("Rice", "Cooking Oil").
  // Hardcoded in Dart today (§5.5); this is the seam that lifts them out.
  @Get("categories")
  listCategories() {
    return this.catalogService.listCategories();
  }

  // The four BNPL plans, seeded from the Flutter app's `BnplPlan.allPlans`
  // (§5.7). The app merges the server's `interestPercent`/`isPopular` over
  // its local rich copy and falls back to the hardcoded list offline.
  @Get("bnpl-plans")
  listBnplPlans() {
    return this.catalogService.listActiveBnplPlans();
  }

  // Promo carousel on the app home + marketplace. Was `MockData.brandBanners`
  // in Dart; managed from the dashboard now.
  @Get("banners")
  listBanners() {
    return this.catalogService.listActiveBanners();
  }
}
