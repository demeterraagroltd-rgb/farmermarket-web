import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { recovaConsents, type Db } from "@farmermarket/db";
import { requestProductionCancel } from "./recova.client";

const log = new Logger("RecovaCancel");
/** Recova holds a record for these; a cancel must reach it. */
const HELD_BY_RECOVA = new Set(["processing", "active"]);
/** Recova may or may not hold a record yet; "not found" means nothing to cancel. */
const MAYBE_HELD = new Set(["submitting", "awaiting_consent", "needs_review"]);

/**
 * Stops Recova collecting for an order that will not go ahead. Call before
 * marking the order rejected or cancelled: if Recova cannot confirm, this
 * throws and the order is left as it was so staff can retry.
 */
export async function cancelRecovaForOrder(db: Db, orderId: string, reason: string) {
  const [consent] = await db.select().from(recovaConsents).where(eq(recovaConsents.orderId, orderId)).limit(1);
  if (!consent || ["cancelled", "failed", "expired"].includes(consent.status)) return;
  if (HELD_BY_RECOVA.has(consent.status) || MAYBE_HELD.has(consent.status)) {
    let result: Awaited<ReturnType<typeof requestProductionCancel>> | null = null;
    try { result = await requestProductionCancel(consent.reference, reason.slice(0, 200)); } catch { /* handled below */ }
    const cancelled = !!result?.ok || (result?.httpStatus === 404 && MAYBE_HELD.has(consent.status));
    if (!cancelled) {
      log.warn(`Could not cancel Recova mandate ${consent.reference} (HTTP ${result?.httpStatus ?? "no response"})`);
      throw new ServiceUnavailableException("Recova did not confirm the mandate was cancelled, so the order was not changed. Try again, or cancel it with Recova before retrying.");
    }
    log.log(`Cancelled Recova mandate ${consent.reference}`);
  }
  await db.update(recovaConsents).set({ status: "cancelled", checkedAt: new Date(), updatedAt: new Date() }).where(eq(recovaConsents.id, consent.id));
}
