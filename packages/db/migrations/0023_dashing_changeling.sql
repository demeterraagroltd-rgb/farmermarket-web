CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_kobo" bigint NOT NULL,
	CONSTRAINT "supplier_invoice_line_positive" CHECK ("supplier_invoice_lines"."quantity" > 0 AND "supplier_invoice_lines"."unit_cost_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"reference" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_kobo" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"operation_id" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "supplier_invoices_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "supplier_invoice_status" CHECK ("supplier_invoices"."status" in ('draft','posted','void')),
	CONSTRAINT "supplier_invoice_positive" CHECK ("supplier_invoices"."total_kobo" > 0),
	CONSTRAINT "supplier_invoice_dates" CHECK ("supplier_invoices"."due_date" >= "supplier_invoices"."invoice_date"),
	CONSTRAINT "supplier_invoice_separate_poster" CHECK ("supplier_invoices"."posted_by" IS NULL OR "supplier_invoices"."posted_by" <> "supplier_invoices"."created_by")
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payment_reversals_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "supplier_payments_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "supplier_payment_positive" CHECK ("supplier_payments"."amount_kobo" > 0),
	CONSTRAINT "supplier_payment_method" CHECK ("supplier_payments"."method" in ('bank_transfer','cash','cheque','other'))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_vendors_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_posted_by_staff_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_voided_by_staff_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_line_unique" ON "supplier_invoice_lines" USING btree ("invoice_id","purchase_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_reference_unique" ON "supplier_invoices" USING btree ("supplier_id",lower(trim("reference")));
--> statement-breakpoint
CREATE FUNCTION preserve_supplier_financial_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Supplier financial records cannot be edited or deleted; use a recorded reversal or void'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_payments_immutable BEFORE UPDATE OR DELETE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE TRIGGER supplier_payment_reversals_immutable BEFORE UPDATE OR DELETE ON supplier_payment_reversals FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE TRIGGER supplier_invoice_lines_immutable BEFORE UPDATE OR DELETE ON supplier_invoice_lines FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE FUNCTION protect_supplier_invoice_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
 SELECT status INTO parent_status FROM supplier_invoices WHERE id = NEW.invoice_id FOR SHARE;
 IF parent_status <> 'draft' THEN RAISE EXCEPTION 'Lines can only be added to a draft invoice'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_invoice_line_insert BEFORE INSERT ON supplier_invoice_lines FOR EACH ROW EXECUTE FUNCTION protect_supplier_invoice_line_insert();
--> statement-breakpoint
CREATE FUNCTION protect_supplier_invoice_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_total bigint;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Supplier invoices cannot be deleted'; END IF;
 IF (to_jsonb(NEW) - ARRAY['status','version','posted_by','posted_at','voided_by','voided_at','void_reason'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','posted_by','posted_at','voided_by','voided_at','void_reason'])
 THEN RAISE EXCEPTION 'Invoice financial details are permanent'; END IF;
 IF OLD.status = 'void' OR (OLD.status = 'posted' AND NEW.status NOT IN ('posted','void'))
 THEN RAISE EXCEPTION 'Invalid invoice transition'; END IF;
 IF OLD.status = 'posted' AND (NEW.posted_by IS DISTINCT FROM OLD.posted_by OR NEW.posted_at IS DISTINCT FROM OLD.posted_at)
 THEN RAISE EXCEPTION 'Invoice posting history is permanent'; END IF;
 IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
   SELECT sum(quantity::bigint * unit_cost_kobo) INTO line_total FROM supplier_invoice_lines WHERE invoice_id = NEW.id;
   IF line_total IS DISTINCT FROM NEW.total_kobo OR NEW.posted_by IS NULL OR NEW.posted_at IS NULL
   THEN RAISE EXCEPTION 'Posted invoice must have matching lines and posting staff'; END IF;
 END IF;
 IF NEW.status = 'void' AND (NEW.voided_by IS NULL OR NEW.voided_at IS NULL OR coalesce(length(trim(NEW.void_reason)),0) < 3)
 THEN RAISE EXCEPTION 'Voiding requires staff and a reason'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_invoice_header_protected BEFORE UPDATE OR DELETE ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION protect_supplier_invoice_header();
