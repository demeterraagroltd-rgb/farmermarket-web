import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export class CreateCategoryDto implements CreateCategoryInput {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() sortOrder?: number;
}

export const createBrandSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().optional(),
  color: z.string().optional(),
  imagePath: z.string().url().optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export class CreateBrandDto implements CreateBrandInput {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() tagline?: string;
  @ApiPropertyOptional() color?: string;
  @ApiPropertyOptional() imagePath?: string;
}

const productStatus = z.enum(["draft", "published", "archived"]);

// §5.5 — the API flattens category/brand ids to strings for the phone app's
// existing FoodItem model; the admin form still deals in ids, since that's
// what's actually referential in the schema. The Flutter `FoodItem` also
// carries `tags` / `isPopular` / `discountPrice`, so the create form must be
// able to set them (it couldn't before).
export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url(),
  priceNaira: z.number().positive(),
  discountPriceNaira: z.number().positive().optional(),
  categoryId: z.string().uuid(),
  brandId: z.string().uuid(),
  unit: z.string().min(1),
  tags: z.array(z.string()).optional(),
  isPopular: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).default(0),
  sortOrder: z.number().int().optional(),
  status: productStatus.optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
export class CreateProductDto implements CreateProductInput {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() imageUrl!: string;
  @ApiProperty() priceNaira!: number;
  @ApiPropertyOptional() discountPriceNaira?: number;
  @ApiProperty() categoryId!: string;
  @ApiProperty() brandId!: string;
  @ApiProperty() unit!: string;
  @ApiPropertyOptional({ type: [String] }) tags?: string[];
  @ApiPropertyOptional() isPopular?: boolean;
  @ApiProperty() stockQuantity!: number;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional({ enum: ["draft", "published", "archived"] })
  status?: "draft" | "published" | "archived";
}

// Every field optional — this is a partial update (`PATCH`).
export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export class UpdateProductDto implements Partial<CreateProductInput> {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiPropertyOptional() priceNaira?: number;
  @ApiPropertyOptional() discountPriceNaira?: number;
  @ApiPropertyOptional() categoryId?: string;
  @ApiPropertyOptional() brandId?: string;
  @ApiPropertyOptional() unit?: string;
  @ApiPropertyOptional({ type: [String] }) tags?: string[];
  @ApiPropertyOptional() isPopular?: boolean;
  @ApiPropertyOptional() stockQuantity?: number;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional({ enum: ["draft", "published", "archived"] })
  status?: "draft" | "published" | "archived";
}

export const updateProductStatusSchema = z.object({ status: productStatus });
export type UpdateProductStatusInput = z.infer<typeof updateProductStatusSchema>;
export class UpdateProductStatusDto implements UpdateProductStatusInput {
  @ApiProperty({ enum: ["draft", "published", "archived"] }) status!:
    | "draft"
    | "published"
    | "archived";
}

// Promo carousel — mirrors the Flutter `BrandBanner` (brand, image, tagline,
// category, colour). Colour is stored as text; accept a hex string.
export const createBannerSchema = z.object({
  brand: z.string().min(1),
  imageUrl: z.string().url(),
  tagline: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export class CreateBannerDto implements CreateBannerInput {
  @ApiProperty() brand!: string;
  @ApiProperty() imageUrl!: string;
  @ApiPropertyOptional() tagline?: string;
  @ApiPropertyOptional() categoryId?: string;
  @ApiPropertyOptional() color?: string;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional() isActive?: boolean;
}
