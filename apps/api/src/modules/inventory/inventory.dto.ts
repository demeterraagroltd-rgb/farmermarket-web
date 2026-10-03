import { z } from "zod";

export const stockMovementSchema = z.object({
  kind: z.enum(["receive", "adjustment"]),
  quantity: z.number().int().min(-1000000).max(1000000).refine((n) => n !== 0, "Quantity cannot be zero"),
  reason: z.string().trim().min(3).max(500),
  reference: z.string().trim().max(160).optional(),
  operationId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
}).refine((v) => v.kind !== "receive" || v.quantity > 0, "Receiving requires a positive quantity");
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export const thresholdSchema = z.object({ lowStockThreshold: z.number().int().min(0).max(1000000) });
export const historyQuerySchema = z.object({ productId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1) });

const warehouseOperation = z.object({productId:z.string().uuid(),warehouseId:z.string().uuid(),operationId:z.string().uuid(),reason:z.string().trim().min(3).max(500),reference:z.string().trim().max(160).default('')});
export const allocationSchema=warehouseOperation.extend({quantity:z.number().int().min(1).max(1000000)});
export const transferSchema=warehouseOperation.extend({destinationId:z.string().uuid(),quantity:z.number().int().min(1).max(1000000)}).refine(v=>v.warehouseId!==v.destinationId,'Choose different warehouses');
export const countSchema=warehouseOperation.extend({onHand:z.number().int().min(0).max(1000000),expectedVersion:z.number().int().min(1)});
export type AllocationInput=z.infer<typeof allocationSchema>;
export type TransferInput=z.infer<typeof transferSchema>;
export type CountInput=z.infer<typeof countSchema>;
