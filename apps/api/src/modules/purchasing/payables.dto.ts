import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s,"Enter a valid date");
export const invoiceSchema = z.object({
  purchaseOrderId:z.string().uuid(), reference:z.string().trim().min(2).max(160),
  invoiceDate:date, dueDate:date, notes:z.string().trim().max(2000).default(""), operationId:z.string().uuid(),
  lines:z.array(z.object({purchaseOrderLineId:z.string().uuid(),quantity:z.number().int().min(1).max(1000000)})).min(1).max(100),
}).refine(v=>v.dueDate>=v.invoiceDate,"Due date cannot precede invoice date")
  .refine(v=>new Set(v.lines.map(l=>l.purchaseOrderLineId)).size===v.lines.length,"Each line must appear once");
export const invoiceActionSchema = z.object({action:z.enum(["post","void"]),version:z.number().int().positive(),reason:z.string().trim().max(500).default("")});
export const paymentSchema = z.object({
  amountNaira:z.number().positive().max(100000000000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001,"Use at most two decimal places"),
  paymentDate:date, method:z.enum(["bank_transfer","cash","cheque","other"]),
  reference:z.string().trim().min(2).max(160),notes:z.string().trim().max(2000).default(""),operationId:z.string().uuid(),
});
export const reversePaymentSchema = z.object({reason:z.string().trim().min(3).max(500)});
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceAction = z.infer<typeof invoiceActionSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export const creditSchema = z.object({
  reference:z.string().trim().min(2).max(160),creditDate:date,
  amountNaira:z.number().positive().max(100000000000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001,"Use at most two decimal places"),
  reason:z.string().trim().min(3).max(1000),operationId:z.string().uuid(),
});
export const creditActionSchema = z.object({action:z.enum(["post","void","reverse"]),version:z.number().int().positive(),reason:z.string().trim().max(500).default("")});
export type CreditInput = z.infer<typeof creditSchema>;
export type CreditAction = z.infer<typeof creditActionSchema>;
