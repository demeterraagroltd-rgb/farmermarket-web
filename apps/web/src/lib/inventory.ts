// Shapes returned by /v1/admin/inventory (apps/api/src/modules/inventory).
// One central warehouse: on hand is what's on the shelves, reserved is held
// for submitted orders not yet dispatched, available = on hand − reserved.

export interface StockRow {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  imageUrl: string;
  category: string;
  status: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
  activeLots: number;
  nextExpiry: string | null; // YYYY-MM-DD
}

export interface Lot {
  id: string;
  productId: string;
  lotCode: string;
  quantityReceived: number;
  quantityRemaining: number;
  receivedAt: string;
  expiryDate: string | null;
  unitCost: number | null;
  vendorId: string | null;
  vendorName?: string | null;
  note: string | null;
}

export type MovementType = "receive" | "reserve" | "release" | "dispatch" | "return" | "adjust";

export interface Movement {
  id: string;
  type: MovementType;
  productId: string;
  productName: string;
  lotId: string | null;
  lotCode: string | null;
  onHandDelta: number;
  reservedDelta: number;
  orderId: string | null;
  reason: string | null;
  note: string | null;
  staffName: string | null;
  createdAt: string;
}

export interface ProductStock {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  imageUrl: string;
  status: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
  lots: Lot[];
  movements: Movement[];
}

export interface PickList {
  orderId: string;
  status: string;
  stockState: string | null;
  planned: boolean;
  lines: {
    productId: string;
    name: string;
    quantity: number;
    shortBy: number;
    lots: { lotId: string; lotCode: string; quantity: number; expiryDate: string | null }[];
  }[];
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  receive: "Received",
  reserve: "Reserved",
  release: "Released",
  dispatch: "Dispatched",
  return: "Returned",
  adjust: "Adjusted",
};

export const ADJUST_REASONS = [
  { value: "damage", label: "Damaged" },
  { value: "spoilage", label: "Spoiled / expired" },
  { value: "count_correction", label: "Count correction" },
  { value: "other", label: "Other" },
] as const;

const DAY_MS = 86_400_000;

/** Whole days from today to a YYYY-MM-DD date; negative once it's passed. */
export function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / DAY_MS);
}

/** "12 Mar 2027" from a YYYY-MM-DD date, without a timezone shift. */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export type StockTone = "error" | "warning" | "success";

export function stockTone(row: { available: number; isLow: boolean }): StockTone {
  if (row.available <= 0) return "error";
  return row.isLow ? "warning" : "success";
}

export function stockLabel(row: { available: number; isLow: boolean }): string {
  if (row.available <= 0) return "Out of stock";
  return row.isLow ? "Low" : "In stock";
}

/** Nest's `{ message }`, or the zod pipe's `{ fieldErrors }`, as one readable string. */
export function apiErrorMessage(body: { message?: unknown; fieldErrors?: Record<string, string[]> }): string | null {
  if (typeof body.message === "string") return body.message;
  if (Array.isArray(body.message)) return body.message.join("\n");
  if (body.fieldErrors) {
    return Object.entries(body.fieldErrors)
      .map(([k, v]) => `${k}: ${v.join(", ")}`)
      .join("\n");
  }
  return null;
}
