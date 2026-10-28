ALTER TABLE "bnpl_plans" ADD COLUMN "duration_days" integer;--> statement-breakpoint
ALTER TABLE "bnpl_plans" ADD COLUMN "test_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Staff test plan: one repayment the day after the order is placed, no interest.
-- Offered only to customers listed in TEST_PLAN_CUSTOMER_PHONES.
INSERT INTO "bnpl_plans" ("name", "duration_months", "duration_days", "test_only", "interest_percent", "is_popular", "is_active", "sort_order")
SELECT 'Test: repay tomorrow', 0, 1, true, 0, false, true, 99
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE "test_only");