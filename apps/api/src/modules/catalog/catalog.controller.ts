import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";

// Public — no auth. Consumed by the public web `/marketplace` page and by
// the Flutter app's `MarketplaceRepository` / `CheckoutRepository` (§10, §14).
@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

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
}
