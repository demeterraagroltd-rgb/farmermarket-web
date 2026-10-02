import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

// Matches exactly what OrdersRepository.placeOrder() in the Flutter app
// already sends (lib/features/orders/data/orders_repository.dart) — that
// file was written against this contract before the API existed. It will need
// the pickup centre + date added: orders are collected, not delivered.
export const createOrderItemSchema = z.object({
  productId: z.string().uuid().optional(),
  bundleId: z.string().uuid().optional(),
  quantity: z.number().int().positive().max(10000),
}).refine((item) => !!item.productId !== !!item.bundleId, "Choose exactly one product or bundle");

const DAY_MS = 24 * 60 * 60 * 1000;

export const createOrderSchema = z.object({
  items: z.array(createOrderItemSchema).min(1),
  pickupCenterId: z.string().uuid(),
  // Coerced to a Date so the column stores a real timestamp, not whatever
  // string the client formatted. The day of slack absorbs the difference
  // between the browser's local "today" and the server's clock.
  pickupDate: z.coerce
    .date()
    .refine((date) => date.getTime() >= Date.now() - DAY_MS, "Pickup date can't be in the past."),
  bnplPlanId: z.string().uuid(),
  // 4-digit transaction code — required to authorize the order.
  txnPin: z.string().regex(/^\d{4}$/, "Transaction code must be 4 digits"),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export class CreateOrderItemDto {
  @ApiPropertyOptional() productId?: string;
  @ApiPropertyOptional() bundleId?: string;
  @ApiProperty() quantity!: number;
}

export class CreateOrderDto implements CreateOrderInput {
  @ApiProperty({ type: [CreateOrderItemDto] })
  items!: CreateOrderItemDto[];

  @ApiProperty({ description: "The pickup centre the buyer will collect from" })
  pickupCenterId!: string;

  @ApiProperty({ description: "When the buyer will collect, e.g. 2026-09-25", example: "2026-09-25" })
  pickupDate!: Date;

  @ApiProperty()
  bnplPlanId!: string;

  @ApiProperty({ description: "4-digit transaction code" })
  txnPin!: string;
}
