// Shared by the account order list and the single-order page, so the same
// order can't read as "info" in one place and "success" in another.
//
// `on_the_way` and `delivered` are still in the API's enum for the mobile app
// and for orders created before collection points existed; the web flow has
// moved to ready_for_pickup / collected / completed.
export type OrderStatusTone = "success" | "warning" | "error" | "info" | "neutral";

export const ORDER_STATUS_TONE: Record<string, OrderStatusTone> = {
  pending_approval: "warning",
  placed: "info",
  confirmed: "info",
  preparing: "info",
  ready_for_pickup: "success",
  collected: "success",
  completed: "success",
  on_the_way: "info",
  delivered: "success",
  rejected: "error",
  cancelled: "neutral",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Awaiting approval",
  placed: "Order placed",
  confirmed: "Credit approved",
  preparing: "Processing",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  completed: "Completed",
  on_the_way: "On the way",
  delivered: "Delivered",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** A human label rather than the raw enum — "pending approval", not "pending_approval". */
export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export interface OrderCollection {
  pickupCenterName?: string | null;
  pickupCenterAddress?: string | null;
  /** Retired: only orders placed before pickup centres existed have one. */
  deliveryAddress?: string | null;
}

/**
 * Where the buyer collects — "FCDA Secretariat, Plot 1 Secretariat Road".
 * Falls back to the legacy street address so an old order still says
 * something true rather than rendering an empty row.
 */
export function pickupLabel(order: OrderCollection): string | null {
  const centre = [order.pickupCenterName, order.pickupCenterAddress].filter(Boolean).join(", ");
  return centre || order.deliveryAddress || null;
}

/** The row label that goes with {@link pickupLabel}. */
export function pickupFieldLabel(order: OrderCollection): string {
  return order.pickupCenterName ? "Pickup centre" : "Delivery address (legacy)";
}
