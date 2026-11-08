-- Apply the agreed one-month plan fee to future orders. Existing order totals
-- and installment records are not rewritten.
UPDATE "bnpl_plans"
SET "interest_percent" = 1
WHERE NOT "test_only" AND "duration_days" IS NULL AND "duration_months" = 1;
