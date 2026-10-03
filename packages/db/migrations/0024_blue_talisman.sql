CREATE TABLE "supplier_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"invoice_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"credit_date" date NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"operation_id" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_credit_notes_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "supplier_credit_notes_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "supplier_credit_positive" CHECK ("supplier_credit_notes"."amount_kobo" > 0),
	CONSTRAINT "supplier_credit_status" CHECK ("supplier_credit_notes"."status" in ('draft','posted','void')),
	CONSTRAINT "supplier_credit_separate_poster" CHECK ("supplier_credit_notes"."posted_by" IS NULL OR "supplier_credit_notes"."posted_by" <> "supplier_credit_notes"."created_by")
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_credit_reversals_credit_note_id_unique" UNIQUE("credit_note_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplier_id_vendors_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_posted_by_staff_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_voided_by_staff_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_reversals" ADD CONSTRAINT "supplier_credit_reversals_credit_note_id_supplier_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."supplier_credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_reversals" ADD CONSTRAINT "supplier_credit_reversals_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credit_reference_unique" ON "supplier_credit_notes" USING btree ("supplier_id",lower(trim("reference")));
--> statement-breakpoint
CREATE TRIGGER supplier_credit_reversals_immutable BEFORE UPDATE OR DELETE ON supplier_credit_reversals FOR EACH ROW EXECUTE FUNCTION preserve_supplier_financial_history();
--> statement-breakpoint
CREATE FUNCTION protect_supplier_credit_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Credit notes cannot be deleted'; END IF;
 IF (to_jsonb(NEW) - ARRAY['status','version','posted_by','posted_at','voided_by','void_reason'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','posted_by','posted_at','voided_by','void_reason'])
 THEN RAISE EXCEPTION 'Credit note financial details are permanent'; END IF;
 IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Posted or void credit notes cannot be changed; use a reversal'; END IF;
 IF NEW.status = 'posted' AND (NEW.posted_by IS NULL OR NEW.posted_at IS NULL)
 THEN RAISE EXCEPTION 'Posting requires an approver and timestamp'; END IF;
 IF NEW.status = 'void' AND (NEW.voided_by IS NULL OR coalesce(length(trim(NEW.void_reason)),0) < 3)
 THEN RAISE EXCEPTION 'Voiding requires staff and a reason'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_credit_note_protected BEFORE UPDATE OR DELETE ON supplier_credit_notes FOR EACH ROW EXECUTE FUNCTION protect_supplier_credit_note();
