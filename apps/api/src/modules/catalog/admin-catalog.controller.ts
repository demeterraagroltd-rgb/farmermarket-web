import { Body, Controller, Delete, Get, Param, Post, Patch, UseGuards, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { uploadCatalogImage } from "../../common/cloudinary";
import { validateCatalogImage } from "./catalog-image";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { BundlesService } from "./bundles.service";
import { bundleSchema, type BundleInput } from "./dto/bundle.dto";
import { CatalogService } from "./catalog.service";
import {
  CreateCategoryDto,
  createCategorySchema,
  CreateBrandDto,
  createBrandSchema,
  CreateBannerDto,
  createBannerSchema,
  CreateProductDto,
  createProductSchema,
  UpdateProductDto,
  updateProductSchema,
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
  constructor(private readonly catalogService: CatalogService, private readonly bundlesService: BundlesService) {}

  @Get("bundles")
  listBundles() { return this.bundlesService.list(); }

  @Post("bundles")
  createBundle(@Body(new ZodValidationPipe(bundleSchema)) body: BundleInput) { return this.bundlesService.save(body); }

  @Patch("bundles/:id")
  updateBundle(@Param("id") id: string, @Body(new ZodValidationPipe(bundleSchema)) body: BundleInput) { return this.bundlesService.save(body, id); }

  @Post("images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  uploadImage(@UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }) {
    validateCatalogImage(file);
    return uploadCatalogImage(file!.buffer);
  }

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

  @Patch("products/:id")
  updateProduct(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(id, body);
  }

  @Patch("products/:id/status")
  updateProductStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductStatusSchema)) body: UpdateProductStatusDto,
  ) {
    return this.catalogService.updateProductStatus(id, body.status);
  }

  @Get("banners")
  listBanners() {
    return this.catalogService.listActiveBanners();
  }

  @Post("banners")
  createBanner(@Body(new ZodValidationPipe(createBannerSchema)) body: CreateBannerDto) {
    return this.catalogService.createBanner(body);
  }

  @Delete("banners/:id")
  deleteBanner(@Param("id") id: string) {
    return this.catalogService.deleteBanner(id);
  }
}
