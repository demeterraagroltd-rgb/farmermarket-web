import { z } from "zod";

export const bundleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens"),
  description: z.string().max(2000).default(""),
  imageUrl: z.union([z.string().url().refine((url) => url.startsWith("https://"), "Use an HTTPS image"), z.literal("")]).nullable().default(null),
  category: z.string().trim().min(1).max(100).default("Bundles"),
  bundlePrice: z.number().positive().max(100000000).multipleOf(0.01).nullable().default(null),
  featured: z.boolean().default(false), active: z.boolean().default(false),
  missingProducts: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  pricingNote: z.string().max(500).default(""),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10000) })).max(50)
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, "Each product can appear only once"),
});
export type BundleInput = z.infer<typeof bundleSchema>;
