# Recova payment confirmation and reconciliation

The staff Recova page separates authorization, Farmer Market's recorded payments,
and staff reports of possible payments. An active mandate is not a receipt.

## Available workflow

1. Open Payments and reconciliation on the Recova dashboard.
2. Review the loan's booked installments, recorded repayments and balance.
3. Record a transaction observed in Recova or the receiving bank's statement.
   Include the source name, transaction reference, payment type, exact naira
   amount and observation time. Do not include BVNs, account numbers or secrets.
4. The report remains **Awaiting verification — not posted**. It does not change
   repayment schedules, the ledger, credit usage or provider collection settings.
5. Finance reviews external evidence. Incorrect reports can be dismissed with a
   reason; the report and audit record remain. A dismissed report does not stop
   Recova's own scheduled collection or recovery.

Only one unresolved report can use the same normalized source name and
transaction reference, including against a different loan or payment type. Use
consistent source names. Dismiss an incorrect report before recording a corrected
version; the old report and audit record remain. This is a manual-report duplicate
guard, not provider webhook idempotency.
Views show the latest 200 setups and latest 200 receipts/reports per loan; counts
of unresolved reports use all reports for the displayed loans. A blank view does
not establish that no money moved. Pending-approval orders without a booked
schedule have no booked balance and cannot receive payment reports here.

## Provider requirements before automatic posting

Request the actual payment webhook schemas and sample success, pending, failed,
partial, duplicate and reversal events; authentication/signature and retry
contract; event and transaction identifiers; loan and installment references;
currency and units; gross debit, fees and net settlement; final-status verification
API; transaction/settlement history for missed events; and collection/recovery
scheduling, retry, pause and stop operations after voluntary repayment.

Do not treat provider acceptance, SMS delivery, mandate creation, or a staff report
as a successful repayment. Implement authenticated event ingestion with durable
deduplication, independent transaction verification, agreed amount allocation,
atomic ledger/credit/schedule updates, reversal handling and replay reconciliation
only after confirming that contract. Complete a controlled production pilot with
a consenting account holder and agreed amount before enabling real collection.

No guessed payment webhook endpoint, verification API, or automatic repayment
posting is exposed by this preparatory implementation. Existing money endpoints
are unchanged. Reports are protected by admin/super-admin staff authentication.
