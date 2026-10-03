# Inventory valuation and cost of goods

Open **Inventory → Valuation & costs**. This first release uses global product FIFO:
the earliest received cost lot supplies the cost of units collected first, across
all pickup warehouses. Location transfers and allocations do not change value.
This is the inventory cost subledger, not a full accounting or tax report.

## Current stock value

Available and reserved units remain on hand until order collection. Accepted PO
receipts create lots at the approved supplier unit cost, in integer kobo. Rejected
goods never create cost lots. Existing opening stock, direct/manual receipts and
positive count corrections have **unknown purchase cost**, never the selling price.
Known value and units missing costs are reported separately. An incomplete known
value must not be treated as the total value of the business's stock.

A super admin can open a product's cost lots and assign an actual cost to an
unknown lot, with a source document/reason. The stock quantity does not change.
Assignments are audited and retry-safe; stale lot versions are rejected. Known
costs cannot be overwritten. An assignment applies only to remaining units and
does not rewrite previously collected orders' unknown cost snapshots. Explicit
zero purchase costs are allowed for genuine free/donated stock, with a reason.

## Collected orders and losses

Collection consumes FIFO quantities and records immutable cost snapshots for
every product, including bundle components and overlapping individual lines.
Reservations, releases and cancellations do not consume cost quantities or create
COGS. Receipt and collection retries cannot duplicate cost records.

The period report includes collected product revenue (order subtotal), known COGS,
missing-cost units and gross product margin. Delivery/service fees are excluded.
Gross margin is shown only when all expected component quantities have cost
snapshots with known costs. Legacy collected orders without cost entries are
incomplete; no historical costs or profits are invented. Dates are inclusive UTC
calendar dates. Gross margin excludes financing costs, bad debts, expenses and tax.

Negative stock corrections and physical count losses consume FIFO quantities but
appear separately as stock losses, not sales COGS. Positive corrections create
unknown-cost stock. Supplier credit notes do not automatically change receipt cost
or historical COGS; valuation adjustments for purchase rebates are future work.

CSV exports are available for current valuation and the displayed COGS period.

## Integrity and boundaries

Migration 0025 adds costing tables, opening unknown-cost quantities and a trigger
on the existing stock movement ledger. Quantity, receipt and cost changes commit
atomically, even for older API callers. Existing available/reserved stock and
warehouse assignments are preserved. Existing collected sales are not backfilled.

Opening quantities include reserved individual products and bundle components.
Reports flag cost quantity mismatches. Direct updates/imports of cached stock
outside the inventory workflow are unsupported; resolve their reconciliation
before relying on valuation. New uncaptured opening quantities are explicitly
marked unknown when a physical movement is posted; excess tracked quantities block
the movement rather than silently discard cost history.

Future work: warehouse-specific costing, batches/expiry, returns, receipt reversals,
landed costs, approved revaluations and adjustments, supplier credit allocation to
inventory, accounting journals and financial statements.
