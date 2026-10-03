# Supplier invoices and payments

Open **Dashboard → Purchasing → Invoices & payments**. This is the supplier
payables subledger in NGN, not a general ledger or a bank payment service.

## Workflow

1. Receive goods against an approved purchase order at a pickup warehouse.
2. Prepare an invoice draft using the supplier's invoice reference, invoice date,
   due date and accepted quantities. The due date initially uses the supplier's
   payment terms and can be adjusted to the actual invoice terms.
3. Costs are copied from the approved PO. Check that the calculated total matches
   the actual supplier document. Rejected goods and quantities already billed by
   posted invoices cannot be invoiced. Separate invoices can cover partial deliveries.
4. A different super admin reviews and posts the draft. Posting rechecks all
   quantities against goods receipts and other posted invoices. Drafts do not
   increase supplier balances. Admins can prepare and view; only super admins can
   post, void, record payments or reverse payment records.
5. After paying the supplier outside the app, record the amount, payment date,
   method, bank/payment reference and notes. Partial payments reduce the balance;
   full payment closes it. Payments cannot exceed the outstanding amount or be
   future-dated. No funds are transferred by this feature.
6. For an incorrect payment entry, enter a reason and **Reverse record**. This
   restores the invoice balance while retaining both records. It does not refund
   the supplier or reverse an actual bank transfer.
7. Void an incorrect invoice with a reason. Any active payment records must first
   be reversed. A voided invoice stops contributing to balances and frees its
   matched quantities. For a corrected replacement, retain the original reference
   in notes and use a distinct correction reference. Existing records are retained.

Outstanding and overdue cards, invoice status filters, payment history and
per-supplier balances are available in the tab. An invoice is overdue when its
due date is earlier than today's UTC calendar date and its posted balance is positive.

## Supplier credit notes

On a posted invoice, choose **Prepare credit note**. Enter the actual supplier
credit document's reference, date, amount and reason. A different super admin
posts the draft. Draft notes leave balances unchanged; posting rechecks that the
amount does not exceed the original invoice total minus active posted credits.
Credit dates cannot precede invoice dates or be future-dated.

Posted credits reduce invoice payables. On a previously paid invoice, any excess
is shown separately as **credit owed by the supplier**, not a negative payable
or a bank refund. The overview and each supplier show outstanding bills and credit
owed separately. Credits are not automatically offset against other invoices.
Refund settlement and allocation to future invoices remain future work.

Use a reason to void a credit draft or reverse a posted credit. The original note
and separate reversal remain visible. Credit references are unique per supplier,
including void/reversed records. Invoice voiding is blocked while active posted
credits exist. Reverse those records first. Credits do not change stock, return
quantities, payment records or PO matching quantities; physical returns need the
dedicated goods-return workflow.

## Integrity and limits

Amounts are stored in integer kobo. Posting and receiving serialize on the PO;
payment and reversal transactions lock their invoice. Operation UUIDs make invoice
creation and payment retries idempotent and reject changed payloads. Normalised
invoice references are unique per supplier. Active payment references cannot be
reused for the same supplier, even on a different invoice.

Posted amounts, invoice lines, payment records and reversals are immutable.
Lifecycle decisions and staff actions are audited. None of these operations change
stock, purchase order costs or customer balances. Migration 0023 only adds the
supplier financial tables and protections; no balances are invented or backfilled.

This first release matches PO prices exactly. Additional taxes, freight, initial
invoice discounts, price discrepancies, advances, one payment split over several
invoices, attachments, bank reconciliation and accounting journals are future work.
Do not adjust quantity to force a mismatched supplier total to fit. Correct the
source documents or wait for the discrepancy/charge workflow.
