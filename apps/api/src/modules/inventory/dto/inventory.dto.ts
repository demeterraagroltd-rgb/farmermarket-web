import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// A delivery arriving at the warehouse. Each one becomes its own lot, which is
// what FIFO dispatch and the expiry alerts work from.
export const receiveStockSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitCostNaira: z.number().positive().optional(),
  expiryDate: isoDate.optional(),
  vendorId: z.string().uuid().optional(),
  // Defaults to now. Backdating is allowed (a delivery logged the next
  // morning) — it decides FIFO order — but the future isn't.
  receivedAt: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;
export class ReceiveStockDto implements ReceiveStockInput {
  @ApiProperty() productId!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional() unitCostNaira?: number;
  @ApiPropertyOptional({ example: "2027-03-31" }) expiryDate?: string;
  @ApiPropertyOptional() vendorId?: string;
  @ApiPropertyOptional() receivedAt?: Date;
  @ApiPropertyOptional() note?: string;
}

export const adjustmentReasons = ["damage", "spoilage", "count_correction", "other"] as const;

// A correction to one lot. Negative for goods lost (damaged, spoiled, missing
// at a count), positive for a count that found more than the books said.
export const adjustStockSchema = z.object({
  lotId: z.string().uuid(),
  quantityDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, "Quantity change can't be zero"),
  reason: z.enum(adjustmentReasons),
  note: z.string().min(1, "Say what happened").max(500),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export class AdjustStockDto implements AdjustStockInput {
  @ApiProperty() lotId!: string;
  @ApiProperty({ description: "Negative removes stock, positive adds it back" }) quantityDelta!: number;
  @ApiProperty({ enum: adjustmentReasons }) reason!: (typeof adjustmentReasons)[number];
  @ApiProperty() note!: string;
}

export const updateThresholdSchema = z.object({
  lowStockThreshold: z.number().int().min(0),
});
export type UpdateThresholdInput = z.infer<typeof updateThresholdSchema>;
export class UpdateThresholdDto implements UpdateThresholdInput {
  @ApiProperty() lowStockThreshold!: number;
}
