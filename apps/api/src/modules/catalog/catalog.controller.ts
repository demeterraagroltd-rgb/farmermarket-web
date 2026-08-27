import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";

// Public — no auth. The plan's phone-app call (§10):
// GET /v1/catalog/products?status=published&available=true
// (query params aren't needed here since the service method already
// encodes exactly that filter — there's only one public view to serve.)
@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("products")
  listProducts() {
    return this.catalogService.listPublishedProducts();
  }
}
