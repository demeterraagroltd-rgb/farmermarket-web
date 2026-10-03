import { z } from "zod";
export const supplierSchema = z.object({
  name:z.string().trim().min(2).max(160), contactName:z.string().trim().max(160).default(""),
  email:z.union([z.string().email(),z.literal("")]).default(""), phone:z.string().trim().max(50).default(""),
  address:z.string().trim().max(500).default(""), paymentTermsDays:z.number().int().min(0).max(365).default(0), isActive:z.boolean().default(true),
});
export const purchaseSchema = z.object({supplierId:z.string().uuid(), warehouseId:z.string().uuid(), notes:z.string().trim().max(2000).default(""),
  lines:z.array(z.object({productId:z.string().uuid(),quantity:z.number().int().min(1).max(1000000),unitCostNaira:z.number().positive().max(100000000).refine(n => Math.abs(n*100-Math.round(n*100))<0.00001,"Use at most two decimal places")})).min(1).max(100),
}).refine(v => new Set(v.lines.map(l => l.productId)).size===v.lines.length,"Each product must appear once");
export const transitionSchema = z.object({action:z.enum(["submit","approve","return","cancel","close"]),version:z.number().int().positive(),reason:z.string().trim().max(500).default("")});
export const updatePurchaseSchema = purchaseSchema.and(z.object({version:z.number().int().positive()}));
export const receiptSchema = z.object({deliveryReference:z.string().trim().min(2).max(160),notes:z.string().trim().max(2000).default(""),operationId:z.string().uuid(),
  lines:z.array(z.object({purchaseOrderLineId:z.string().uuid(),accepted:z.number().int().min(0).max(1000000),rejected:z.number().int().min(0).max(1000000).default(0)}).refine(l => l.accepted+l.rejected>0,"Enter accepted or rejected quantities")).min(1).max(100),
}).refine(v => new Set(v.lines.map(l => l.purchaseOrderLineId)).size===v.lines.length,"Each line must appear once");
export type SupplierInput = z.infer<typeof supplierSchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type TransitionInput = z.infer<typeof transitionSchema>;
