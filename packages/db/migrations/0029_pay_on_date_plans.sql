-- Short, interest-free plans collected by Recova on a fixed date, for customers
-- who would otherwise choose Pay Now. One payment, counted from order placement.
INSERT INTO "bnpl_plans" ("name", "duration_months", "duration_days", "test_only", "interest_percent", "is_popular", "is_active", "sort_order")
SELECT 'Pay tomorrow', 0, 1, false, 0, false, true, 0
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE "duration_days" = 1 AND NOT "test_only");--> statement-breakpoint
INSERT INTO "bnpl_plans" ("name", "duration_months", "duration_days", "test_only", "interest_percent", "is_popular", "is_active", "sort_order")
SELECT 'Pay in 7 days', 0, 7, false, 0, false, true, 0
WHERE NOT EXISTS (SELECT 1 FROM "bnpl_plans" WHERE "duration_days" = 7 AND NOT "test_only");
