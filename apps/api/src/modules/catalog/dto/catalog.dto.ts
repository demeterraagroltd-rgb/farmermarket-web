import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

export const createCategorySchema = z.object({ name: z.string().min(1) });
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export class CreateCategoryDto implements CreateCategoryInput {
  @ApiProperty() name!: string;
}

export const createBrandSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().optional(),
  color: z.string().optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export class CreateBrandDto implements CreateBrandInput {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() tagline?: string;
  @ApiPropertyOptional() color?: string;
}

// §5.5 — the API flattens category/brand ids to strings for the phone app's
// existing FoodItem model; the admin form still deals in ids, since that's
// what's actually referential in the schema.
export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url(),
  priceNaira: z.number().positive(),
  discountPriceNaira: z.number().positive().optional(),
  categoryId: z.string().uuid(),
  brandId: z.string().uuid(),
  unit: z.string().min(1),
  stockQuantity: z.number().int().min(0).default(0),
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
  @ApiProperty() stockQuantity!: number;
}

export const updateProductStatusSchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
});
export type UpdateProductStatusInput = z.infer<typeof updateProductStatusSchema>;
export class UpdateProductStatusDto implements UpdateProductStatusInput {
  @ApiProperty({ enum: ["draft", "published", "archived"] }) status!:
    | "draft"
    | "published"
    | "archived";
}
