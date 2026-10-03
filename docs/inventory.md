# Inventory

Admins and super admins use **Dashboard → Inventory** to receive supplier stock,
record corrections with a reason, set low-stock thresholds, and inspect movement
history. Catalog remains the place to edit product descriptions, images, prices,
and publication status; existing stock cannot be silently overwritten there.
New products can have an initial stock quantity, recorded as an opening movement.

Available stock is `products.stockQuantity`. Checkout reserves it immediately.
Reserved stock is calculated from open orders and their saved component quantities;
on hand is available plus reserved. Delivery releases the reservation without a
second available-stock deduction. Rejection/cancellation returns stock once.
Bundles share product inventory; their availability is limited by the component
with the fewest complete bundles possible.

Receipts require a positive quantity; adjustments can add or remove available
stock. A reason is required and a supplier/delivery/count reference is optional.
Retries use an operation UUID to avoid recording a receipt twice. Transactions
and product locks prevent overselling or adjustments below zero.

Migration 0018 preserves current quantities and records opening available
balances. History starts at rollout; it does not reconstruct earlier movements.
Movement rows cannot be updated or deleted; errors require a correcting movement.
The ledger retains the product name, quantity changes, available balance, reason,
staff member and order reference. Existing reserved orders remain included in the
overview even though their original checkout predates the ledger.

Low-stock alerts are dashboard counts and filters, based on available stock at or
below a configurable threshold. Pickup warehouse balances, stock allocation,
transfers and physical counts are described in warehouses.md. Purchasing and goods
receipts are described in purchasing.md. Email alerts, supplier payable balances
and cost valuation are later phases.
