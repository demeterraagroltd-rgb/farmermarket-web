# Farmer Market ERP implementation specification

Status: implementation plan, 3 October 2026. Proposed business rules below are
starting defaults, not confirmation of current warehouse or supplier practices.

## Outcome

Connect purchasing, receiving, inventory and fulfilment using the existing
Farmer Market catalog, orders, bundles, staff accounts and Neon PostgreSQL
database. Preserve customer checkout, credit verification and repayment flows.
Deliver purchasing first; extend into location-based warehouse operations next.

First end-to-end scenario: an admin creates a supplier and purchase order; a
super admin approves it; an admin receives part of the delivery; inventory rises
once; the purchase order shows outstanding quantities; the supplier invoice and
payments show the remaining amount owed.

## Existing foundation and gaps

| Existing capability | Reuse | Required extension |
| --- | --- | --- |
| Products, categories, brands and SKUs | Existing product identities | Explicit units, supplier product references and purchase costs |
| Vendor table and optional product vendor reference | Assess for migration into suppliers | Contacts, terms, status; allow multiple suppliers per product |
| Available product stock | Checkout and bundle stock source | Receipt references, then location balances |
| Inventory movement history | Immutable quantity events | Purchasing references, location and batch references |
| Receive/adjust UI | Existing stock controls | Receive against a purchase order; restrict unlinked receipts |
| Orders and saved bundle components | Existing reservation quantities | Location allocation, picking and collection confirmation |
| Pickup centres | Existing collection destination and warehouse identity, as requested | Per-location stock balances, transfers, counts and order reservations |
| Staff roles and audit logs | Existing identity and access guards | Purchasing approval, warehouse and payable permissions |
| Credit and repayments | Existing customer finance workflows | Later accounting reconciliation, not supplier balances mixed with customer credit |
| Cost price field | Retain as existing optional reference | Historical costs and a defined valuation policy; field alone is not accounting |

The inventory feature is currently local code with its opening-balance migration
applied to Neon. Confirm deployed API/web versions before rolling out dependent
ERP changes. Do not reconstruct unsupported historical movements or costs.

## Phase 1: operational foundation

### Defaults

- Use existing pickup centres as warehouses, as requested. Select the receiving pickup warehouse on each purchase order; do not create a separate warehouse directory.
- Keep each existing product's sale unit as its stock unit. Quantity is a whole
  number of those units. No automatic carton splitting or kilogram conversion.
- Store monetary amounts as integer kobo, following existing money handling.
- Admin prepares purchase orders and records receipts. Super admin approves.
- The preparer cannot approve their own purchase order. Add a second authorised
  approver before enabling purchasing if staffing does not permit this workflow.
- Approved documents retain product, unit and cost snapshots even if catalog
  records change. Referenced suppliers/products are deactivated, not deleted.
- Number documents using transaction-safe sequences: PO, GRN, SI and SP prefixes.
  Numbers are unique and never reused; gaps are acceptable. UUIDs remain internal IDs.
- Record actor, event time and reason for approvals, corrections and reversals.

### Deliverables

Inventory reconciliation report; sale-unit/SKU review; supplier migration map;
permission matrix; numbered-document mechanism; schema and API conventions.
Report unknown opening costs explicitly instead of using selling prices as costs.

## Phase 2: purchasing and receiving

### Screens

| Screen | Main actions and information |
| --- | --- |
| Suppliers | Search, create/edit contact details, payment terms, deactivate, view purchase history |
| Purchase orders | Filter by supplier/status/date, create draft, submit for approval |
| Purchase order detail | Item/unit/quantity/cost snapshots, totals, approvals, delivery progress, related receipts |
| Receive delivery | Select approved PO, supplier delivery reference, quantities accepted/rejected, notes |
| Goods receipt detail | GRN number, receiver, received quantities, stock movements and corrections |
| Supplier invoices | Supplier invoice number/date/due date, PO/receipt links, amounts and matching exceptions |
| Supplier balances | Invoice total, recorded payments/credits, outstanding balance and due dates |

### Purchase order lifecycle

Draft → Submitted → Approved → Partially received → Fully received → Closed.
Submitted orders can be returned for changes with a reason. Draft/submitted
orders can be cancelled; approved orders can close remaining quantities with
approval and a reason. Closing or cancelling never removes already received goods.
Approved quantities or costs cannot be silently edited: use a versioned amendment
requiring approval, or close remaining quantities and create a new PO.

### Receiving rules

- Only approved, open purchase-order lines may be received.
- Accepted quantity must be positive and no greater than the outstanding approved
  quantity. Reject over-delivery in the first release rather than silently accept it.
- Record rejected goods separately; they do not increase sellable stock.
- Multiple deliveries are allowed. Compute remaining quantity from posted receipts
  and authorised reversals, not from a manually editable status field.
- Post GRN, receipt lines, inventory movements and PO progress in one transaction.
- Lock affected PO lines and products in a consistent order. Each posting uses an
  operation UUID; retries return the original result without adding stock again.
- Posted receipts cannot be edited/deleted. A correcting reversal references the
  original receipt, has a reason and requires approval. It cannot remove reserved
  or already sold quantities; those exceptions require a separate reconciliation.
- Existing standalone Receive remains for opening balances or exceptional receipts
  with a documented reason. Normal supplier deliveries use the PO workflow.

### Supplier invoices and payments

Receiving goods and recording an invoice are separate events. An invoice may
arrive before or after a delivery. Match supplier, quantities and agreed costs;
show unmatched invoices and discrepancies. Prevent duplicate invoice references
for the same supplier, accounting for whitespace/case normalisation.

Supplier outstanding balance is posted invoices minus allocated recorded payments
and credit notes. Do not derive it from PO totals. First-release payment recording
captures date, amount, method and reference; it does not send money. Prevent
over-allocation, duplicate payment postings and negative invoice balances.
Posted monetary records require correcting entries rather than overwrite/delete.
Tax treatment and financial posting rules require a later accounting specification;
do not describe these operational balances as complete statutory accounts.

### Proposed records

| Record | Important fields |
| --- | --- |
| suppliers | ID, name, contacts, address, terms, active status |
| supplier_products | Supplier/product IDs, supplier SKU, agreed unit, optional quoted cost |
| purchase_orders | Number, supplier, lifecycle, preparer, approver, dates, version |
| purchase_order_lines | Product ID plus name/unit snapshot, ordered quantity, unit cost kobo |
| goods_receipts | Number, PO, delivery reference, receiver, posting time, operation ID |
| goods_receipt_lines | PO line, accepted/rejected quantities, notes |
| supplier_invoices / lines | Invoice reference, supplier, dates, matched PO/receipts, amounts |
| supplier_payments / allocations | Payment reference, amount, invoice allocation, actor |
| supplier_credit_notes | Invoice reference, amount, reason, approval and posting metadata |

Extend inventory movements with receipt/reversal references. Do not create a second
independent product stock counter. Public marketplace response contracts stay stable.

### Permissions

| Action | Admin | Super admin | Credit / sales |
| --- | --- | --- | --- |
| Supplier management, PO preparation | Yes | Yes | No |
| Submit own draft | Yes | Yes | No |
| Approve PO prepared by another staff member | No | Yes | No |
| Receive approved goods | Yes | Yes | No |
| Approve receipt reversal or close undelivered remainder | No | Yes | No |
| View supplier invoices/balances | Yes | Yes | No |
| Post supplier payment/credit correction | No initially | Yes | No |

Enforce these on API endpoints, not only navigation. Later introduce dedicated
buyer, warehouse and accounts permissions without weakening existing role guards.

### Release acceptance checks

1. An approved PO for 20 cartons accepts a receipt of 8: available stock increases
   by 8, remaining quantity is 12, and a second receipt can complete the order.
2. Retrying the same receipt leaves one GRN and one movement per affected product.
3. Concurrent receipts cannot exceed outstanding quantities; failures roll back all
   rows and stock changes. Duplicate operation IDs with changed data are rejected.
4. An admin cannot self-approve or approve a PO; unauthorised roles receive a denial.
5. Rejected goods never become available to checkout or bundles.
6. Product renaming/repricing leaves approved PO and posted GRN snapshots intact.
7. Posting an invoice changes payables but does not change physical stock.
8. A partial payment reduces only allocated invoice balances; unmatched amounts and
   discrepancies remain visible. Duplicate invoice/payment postings are rejected.
9. Existing checkout, bundle reservations, cancellation releases and deliveries
   continue to reconcile after purchasing receipts are introduced.

## Phase 3: warehouse operations

### Screens and workflows

- Locations: existing pickup centres that hold stock, with active
  status. Do not infer balances from customer pickup-centre selections.
- Location inventory: available, reserved, on-hand and quarantined quantities.
- Transfers: prepare, approve where required, dispatch and receive. Dispatched stock
  is in transit and unavailable at both locations until acknowledged at destination.
- Stock counts: freeze a location/product scope or reconcile intervening movements;
  enter physical counts, review variances, approve and post correcting movements.
- Batches: receiving batch/expiry details for designated products; pick by earliest
  eligible expiry, quarantine damaged/expired stock and require explicit disposition.
- Picking/collection: allocate orders to a source location, pick saved product/bundle
  component quantities, confirm customer collection and retain actor/time references.

### Data and migration

Reuse pickup_centers for warehouse identity; add product_location_balances, stock_transfers and lines,
stock_counts and lines, inventory_batches and order_stock_allocations. Record both
ends of each transfer using a shared reference. Derive stock totals from the location
model; if product.stockQuantity remains for compatibility, maintain it transactionally
as an aggregate of available stock, never as an independently editable balance.

Before migrating legacy balances, confirm their actual pickup warehouse; do not guess. Preserve totals and reconcile existing reservations against saved order lines. New purchase receipts already record the selected pickup warehouse.
Unknown batch/expiry information remains explicitly unknown; do not invent dates.
Define the customer promise and warehouse-routing rule before enabling multiple
fulfilment locations. Cross-location bundle components cannot appear available if
the selected fulfilment route cannot supply the complete bundle.

### Release acceptance checks

1. Moving 5 units from A to B preserves total physical units, including in-transit
   stock; neither location can sell dispatched units before receipt.
2. Order allocations and transfers compete safely for the same available stock.
3. Transfer retries, rejected deliveries and approved corrections are traceable and
   cannot duplicate goods. Partial transfer receipt retains the undelivered remainder.
4. A count variance cannot overwrite reservations or disregard concurrent movements.
5. Expired/quarantined batches cannot be sold; eligible batch selection is auditable.
6. Global totals equal location totals; reservations equal open order allocations.
7. Bundles reserve their real components at eligible locations using purchase snapshots.

## Implementation sequence and rollout

1. Audit deployed versions and reconcile existing available/reserved stock. Record
   unknown costs and units, and prepare a restorable backup before migrations.
2. Implement supplier management, document numbering and PO drafts.
3. Add submission/approval and immutable approved-line snapshots.
4. Add transactional receiving and link GRNs to existing inventory history.
5. Add supplier invoice matching, payment recording and balances.
6. Pilot one real supplier delivery; reconcile PO, GRN and stock before broad use.
7. Introduce location balances using confirmed pickup warehouses and aggregate checks.
8. Add transfers/counts, then batches and order allocation.

Each slice includes database migration, guarded API, dashboard UI, SQL integration
tests and browser checks. Deploy additive schema before enabling new workflows.
Monitor reconciliation failures; disable affected posting workflows instead of
silently repairing balances. Roll back application exposure while retaining posted
documents; do not erase operational history as a rollback strategy.

## Later phases and decisions

Accounting, customer invoices/returns, bank reconciliation, cost valuation,
profitability and cash-flow reporting follow a separate specification. Confirm
costing policy, opening balances and tax treatment with the business accountant.
No automatic payouts, regulatory accounting claims or invented opening costs.

Before the corresponding workflow goes live, confirm actual warehouse locations,
staff able to prepare/approve separately, carton-to-unit conversion needs, supplier
payment terms, receiving tolerances and which products require batch/expiry tracking.
These questions do not block building supplier management and PO drafts.
