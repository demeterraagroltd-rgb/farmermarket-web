ALTER TABLE "products" ADD COLUMN "pricing_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_pricing_mode" CHECK ("products"."pricing_mode" IN ('manual', 'percentage'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "percentage_pricing_cost" CHECK ("products"."pricing_mode" <> 'percentage' OR ("products"."cost_price_kobo" IS NOT NULL AND "products"."cost_price_kobo" > 0 AND "products"."discount_price_kobo" IS NULL));
--> statement-breakpoint
INSERT INTO "config" ("key", "value") VALUES ('catalog_pricing', '{"markupPercent":10,"insurancePercent":1}'::jsonb) ON CONFLICT ("key") DO NOTHING;
