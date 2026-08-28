import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// Matches exactly what OrdersRepository.placeOrder() in the Flutter app
// already sends (lib/features/orders/data/orders_repository.dart) — that
// file was written against this contract before the API existed.
export const createOrderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const createOrderSchema = z.object({
  items: z.array(createOrderItemSchema).min(1),
  deliveryAddress: z.string().min(1),
  bnplPlanId: z.string().uuid(),
  // 4-digit transaction code — required to authorize the order.
  txnPin: z.string().regex(/^\d{4}$/, "Transaction code must be 4 digits"),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export class CreateOrderItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() quantity!: number;
}

export class CreateOrderDto implements CreateOrderInput {
  @ApiProperty({ type: [CreateOrderItemDto] })
  items!: CreateOrderItemDto[];

  @ApiProperty()
  deliveryAddress!: string;

  @ApiProperty()
  bnplPlanId!: string;

  @ApiProperty({ description: "4-digit transaction code" })
  txnPin!: string;
}
