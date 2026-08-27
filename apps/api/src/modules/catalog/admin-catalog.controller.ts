import { Body, Controller, Get, Param, Post, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CatalogService } from "./catalog.service";
import {
  CreateCategoryDto,
  createCategorySchema,
  CreateBrandDto,
  createBrandSchema,
  CreateProductDto,
  createProductSchema,
  UpdateProductStatusDto,
  updateProductStatusSchema,
} from "./dto/catalog.dto";

// §6.2: "Products — create/edit draft" and "publish to app" are both
// super_admin + admin only — credit and sales get nothing here.
@ApiTags("catalog")
@ApiBearerAuth()
@Controller("admin/catalog")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("ping")
  ping(@CurrentStaff() staff: AuthenticatedStaff) {
    return { ok: true, staffId: staff.staffId, role: staff.role };
  }

  @Get("categories")
  listCategories() {
    return this.catalogService.listCategories();
  }

  @Post("categories")
  createCategory(@Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryDto) {
    return this.catalogService.createCategory(body);
  }

  @Get("brands")
  listBrands() {
    return this.catalogService.listBrands();
  }

  @Post("brands")
  createBrand(@Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrandDto) {
    return this.catalogService.createBrand(body);
  }

  @Get("products")
  listProducts() {
    return this.catalogService.listAllProducts();
  }

  @Post("products")
  createProduct(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.catalogService.createProduct(body, staff.staffId);
  }

  @Patch("products/:id/status")
  updateProductStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductStatusSchema)) body: UpdateProductStatusDto,
  ) {
    return this.catalogService.updateProductStatus(id, body.status);
  }
}
