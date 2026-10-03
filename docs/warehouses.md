# Pickup warehouse inventory

All pickup centres are stock warehouses, using their existing identities. Admins
and super admins manage these balances under **Dashboard → Inventory → Stock by
pickup warehouse**. Pickup centres remain editable in the existing centre screen.

## Opening stock

Existing stock is deliberately **unassigned**, as requested. Migration adds empty
warehouse balances and leaves product quantities and existing orders untouched.
New catalog products with initial stock also start unassigned. Select Unassigned
stock, choose Allocate for a product, then its real location and quantity. This
moves existing stock into the location without increasing the total. Repeat to
split a product across locations. Allocate opening balances before using a physical
count to avoid confusing unassigned opening stock with newly discovered stock.

Deploy the API and dashboard together before allocating shared production stock.
The old API knows only global stock; the new API requires the chosen pickup
warehouse to have stock. Unassigned stock cannot fulfil new pickup orders.

## Receiving and moving goods

Purchase-order receipts increase the PO's pickup warehouse and the global
available total in one transaction. Inventory Receive/Adjust also asks for a
warehouse. Legacy API calls without one affect only unassigned stock, and cannot
remove allocated stock. Stock received against a PO should use Purchasing so its
delivery reference, accepted/rejected quantities and GRN remain connected.

Select a warehouse and Transfer to move available stock to another active pickup
warehouse. It posts paired source/destination history atomically. Global stock
does not change; reserved goods cannot be transferred. An inactive source can be
emptied into an active location, preserving its historic records.

## Counts

Count the physical on-hand quantity, including reserved goods. The system compares
it to available + reserved and posts the difference as an adjustment. A reason
is required, and the history retains the physical result. Counts cannot be below
reserved stock; affected reservations need resolving first. A balance version
prevents an old count overwriting receipts, transfers or checkout reservations
posted while the count form was open. Zero-difference counts still retain history.
Counts post immediately; approval queues, multi-product count sessions, batches,
expiry dates and stock valuation are later capabilities.

## Orders

New orders reserve stock only at the selected pickup location. Product/bundle
component demand is aggregated before posting, so the same ingredient in multiple
bundles cannot be oversold. Web checkout previews location shortages; the server
rechecks every quantity inside the transaction, including orders from the phone
app. Rejection/cancellation returns stock to the original warehouse once.
Collection/delivery clears reserved quantities without deducting available stock
a second time. Renaming or deactivating a centre does not move existing orders.

Pre-warehouse orders retain unassigned reservations. Use the existing-order
assignment form in Inventory to attribute them to their selected pickup centre
without deducting available stock again. Until assigned, they can still complete
or cancel using the legacy reservation; cancellations return to unassigned stock.

## Reconciliation and history

Global available = total warehouse available + unassigned available.
Global reserved = allocated reservations + legacy unassigned reservations.
On hand = available + reserved. The existing product stock column remains the
global available cache used by the storefront, public bundle listing and phone
app; seeing global availability does not guarantee availability at every centre.
Warehouse history stores names/unit snapshots, before/after quantities, actor,
reason, references and links to orders and the global inventory movement.
Transfer entries share an operation reference. Posting retries cannot duplicate
stock, and reusing an operation UUID with changed fields is rejected. Database
constraints prevent negative balances or allocated available exceeding the global
total, and warehouse movement history is append-only.

Manual corrections require a new adjustment/count with a reason; history cannot
be rewritten. A recorded sale unit cannot be silently changed to another size.
Use a separate product for different bag, bottle or carton sizes.
