-- drizzle-kit generated this without a USING clause; Postgres has no
-- implicit text->boolean cast, so this would fail as written. Coalescing
-- handles any NULL rows (the column had no NOT NULL constraint before).
ALTER TABLE "applications" ALTER COLUMN "employer_verified" SET DATA TYPE boolean USING (COALESCE("employer_verified", 'false')::boolean);--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "employer_verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "employer_verified" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "identity_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "documents_verified" boolean DEFAULT false NOT NULL;