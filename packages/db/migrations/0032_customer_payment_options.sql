-- Retire short dated offerings without deleting plans referenced by existing orders.
UPDATE "bnpl_plans" SET "is_active" = false
WHERE NOT "test_only" AND "duration_days" IS NOT NULL;--> statement-breakpoint
-- Preserve existing fees and identifiers for monthly plans.
UPDATE "bnpl_plans"
SET "name" = CASE "duration_months"
  WHEN 0 THEN 'Pay Now'
  WHEN 1 THEN 'Pay in a month'
  WHEN 2 THEN 'Pay in 2 monthly installments'
  WHEN 3 THEN 'Pay in 3 monthly installments'
END, "sort_order" = "duration_months"
WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" BETWEEN 0 AND 3;
--> statement-breakpoint
INSERT INTO "bnpl_plans" ("name", "duration_months", "interest_percent", "is_popular", "sort_order")
SELECT 'Pay Now', 0, 0, false, 0
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" = 0);
--> statement-breakpoint
INSERT INTO "bnpl_plans" ("name", "duration_months", "interest_percent", "is_popular", "sort_order")
SELECT 'Pay in a month', 1, 0, true, 1
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" = 1);
--> statement-breakpoint
INSERT INTO "bnpl_plans" ("name", "duration_months", "interest_percent", "is_popular", "sort_order")
SELECT 'Pay in 2 monthly installments', 2, 2, false, 2
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" = 2);
--> statement-breakpoint
INSERT INTO "bnpl_plans" ("name", "duration_months", "interest_percent", "is_popular", "sort_order")
SELECT 'Pay in 3 monthly installments', 3, 5, false, 3
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" = 3);
