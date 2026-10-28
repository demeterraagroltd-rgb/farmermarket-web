import { ConflictException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  applications, bnplPlans, brands, categories, creditProfiles, ledgerEntries, orders, pickupCenters,
  products, recovaConsents, repaymentSchedules, repayments, staff, warehouseStocks, type Db,
} from "@farmermarket/db";
import { ApplicationsService } from "../applications/applications.service";
import { OrdersService } from "../orders/orders.service";
import { WalletService } from "../wallet/wallet.service";
import { LedgerService } from "../ledger/ledger.service";
import { assertSandboxEnabled } from "./recova.client";
import { previewRepayment } from "./recova-policy";

export const JOURNEY_STEPS = [
  "Submit test application", "Verify and approve credit", "Place food order", "Practise mandate authorisation",
  "Approve financed order", "Fulfil test order", "Collect first instalment", "Miss second collection",
  "Reach maturity with arrears", "Recover part of the debt", "Recover remaining debt and close",
];
type Event = { title: string; detail: string; source: "Farmer Market service" | "Simulated bank outcome"; at: string };
type Run = {
  id: string; owner: string; db: Db; close: () => Promise<void>; next: number; error?: string;
  app: ApplicationsService; orderService: OrdersService; wallet: WalletService;
  staffId: string; applicationId?: string; userId?: string; orderId?: string;
  productId: string; planId: string; centreId: string; mandate: string;
  events: Event[]; asOf: string; processed: Set<string>;
};

/** Real domain services against a private, disposable PostgreSQL database.
 * This class never receives the application's DB provider or a provider client.
 * Its bank outcomes are explicitly synthetic, not Recova acceptance tests. */
@Injectable()
export class RecovaJourneyService implements OnModuleDestroy {
  private run?: Run;
  private queue: Promise<unknown> = Promise.resolve();

  private check() {
    assertSandboxEnabled();
    if (process.env.NODE_ENV === "production") throw new ServiceUnavailableException("The practice journey is available on the local development API only.");
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async onModuleDestroy() { await this.queue; await this.run?.close(); }

  async status(owner: string) {
    this.check(); await this.queue;
    if (!this.run || this.run.owner !== owner) return { started: false, steps: JOURNEY_STEPS };
    return this.view(this.run);
  }

  start(owner: string) {
    return this.exclusive(async () => {
      this.check();
      if (this.run && this.run.owner !== owner) throw new ConflictException("Another staff member has an active practice journey on this local API.");
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      const client = new PGlite();
      try {
        const local = drizzle(client);
        await migrate(local, { migrationsFolder: resolve(__dirname, "../../../../../packages/db/migrations") });
        const db = local as unknown as Db;
        const [actor] = await db.insert(staff).values({ fullName: "Sandbox credit officer", email: "officer@example.test", passwordHash: "not-a-login-credential", role: "admin" }).returning();
        const [category] = await db.insert(categories).values({ name: "Sandbox groceries" }).returning();
        const [brand] = await db.insert(brands).values({ name: "Sandbox brand" }).returning();
        const [product] = await db.insert(products).values({ name: "Practice food basket", imageUrl: "/icon.png", categoryId: category.id, brandId: brand.id, unit: "basket", priceKobo: 6_000_000n, stockQuantity: 10, status: "published" }).returning();
        const [centre] = await db.insert(pickupCenters).values({ name: "Sandbox pickup centre", address: "Synthetic test location" }).returning();
        await db.insert(warehouseStocks).values({ productId: product.id, warehouseId: centre.id, available: 10 });
        const [plan] = await db.insert(bnplPlans).values({ name: "Practice 3 months — no financing interest", durationMonths: 3, interestPercent: 0 }).returning();
        // Test adapters are confined to this isolated fixture. No credentials,
        // OTPs, SMS, email or identity data are sent to any external service.
        const email = { send: async () => undefined } as never;
        const otp = { assertPhoneVerified: async () => undefined } as never;
        const auth = { assertTxnPin: async () => undefined } as never;
        const kyc = { assertVerified: async () => undefined, assertSubmitted: async () => undefined, getVerificationStatus: async () => "verified" } as never;
        const ledger = new LedgerService();
        const next: Run = {
          id: `fm-practice-${randomUUID()}`, owner, db, close: () => client.close(), next: 0,
          app: new ApplicationsService(db, email, otp), orderService: new OrdersService(db, ledger, auth, kyc, email),
          wallet: new WalletService(db, ledger, auth, email), staffId: actor.id,
          productId: product.id, planId: plan.id, centreId: centre.id, mandate: "not requested",
          events: [], asOf: new Date().toISOString(), processed: new Set(),
        };
        await this.run?.close(); this.run = next;
        return this.view(next);
      } catch (e) { await client.close(); throw e; }
    });
  }

  advance(owner: string, all = false) {
    return this.exclusive(async () => {
      this.check();
      const r = this.run;
      if (!r || r.owner !== owner) throw new ConflictException("Start your practice journey first.");
      if (r.error) throw new ConflictException("This run stopped after an error. Start a fresh practice journey.");
      try {
        do { if (r.next < JOURNEY_STEPS.length) await this.step(r); }
        while (all && r.next < JOURNEY_STEPS.length);
      } catch (e) { r.error = e instanceof Error ? e.message : "Practice step failed"; throw e; }
      return this.view(r);
    });
  }

  private async schedules(r: Run) {
    if (!r.orderId) return [];
    return r.db.select().from(repaymentSchedules).where(eq(repaymentSchedules.orderId, r.orderId)).orderBy(asc(repaymentSchedules.installmentNumber));
  }

  /** One simulated provider event can allocate across installments, once only. */
  private async receive(r: Run, eventId: string, amount: bigint) {
    if (r.processed.has(eventId)) return;
    const rows = await this.schedules(r);
    const owed = rows.reduce((sum, row) => sum + row.amountKobo - row.amountPaidKobo, 0n);
    if (amount <= 0n || amount > owed) throw new ConflictException("Practice payment exceeds the balance.");
    await r.db.transaction(async (tx) => {
      let remaining = amount;
      for (const row of rows) {
        const available = row.amountKobo - row.amountPaidKobo;
        const part = remaining < available ? remaining : available;
        if (part > 0n) { await r.wallet.applyRepaymentTx(tx, row.id, part); remaining -= part; }
        if (remaining === 0n) break;
      }
    });
    r.processed.add(eventId);
  }

  private async step(r: Run) {
    const source: Event["source"] = [3, 6, 7, 9, 10].includes(r.next) ? "Simulated bank outcome" : "Farmer Market service";
    let detail = "";
    switch (r.next) {
      case 0: {
        const a = await r.app.create({ fullName: "Sandbox Customer — Practice Only", phone: "00000000000", email: "customer@example.test", employer: "Synthetic employer", employmentType: "Private", requestedLimitNaira: 100000, netMonthlySalaryNaira: 200000, salaryDay: 25 });
        r.applicationId = a.id; r.userId = a.userId!;
        detail = "A synthetic customer's application was created through ApplicationsService in the isolated database. Phone verification and notification delivery use test adapters.";
        break;
      }
      case 1:
        await r.app.setVerification(r.applicationId!, { identityVerified: true, employerVerified: true, documentsVerified: true });
        await r.app.decide(r.applicationId!, r.staffId, { outcome: "approved", approvedLimitNaira: 100000, notes: "Synthetic practice approval; not a real lending decision" });
        detail = "The practice checklist was marked verified and the real approval service created a ₦100,000 test credit limit and decision history.";
        break;
      case 2: {
        const order = await r.orderService.create(r.userId!, { items: [{ productId: r.productId, quantity: 1 }], bnplPlanId: r.planId, pickupCenterId: r.centreId, pickupDate: new Date(Date.now() + 86_400_000), txnPin: "0000" });
        r.orderId = order.id;
        detail = "The actual checkout service reserved a test food basket and created a pending order. Goods ₦60,000 + delivery ₦500 + service fee ₦1,800 = ₦62,300. Financing/default interest is zero for this practice case.";
        break;
      }
      case 3:
        // Recorded in the isolated database only, so approval's real mandate check passes.
        await r.db.insert(recovaConsents).values({ userId: r.userId!, orderId: r.orderId!, reference: `${r.id}-mandate`, status: "active",
          purpose: "Collection", bankCode: "000", accountLast4: "0000", payloadEncrypted: "simulated", scheduleSnapshot: [], consentVersion: "practice" });
        r.mandate = "active — SIMULATED";
        detail = "Customer consent and bank mandate activation are simulated here. No Recova request was made. A provider-verified active mandate is still required in the real integration.";
        break;
      case 4:
        if (r.mandate !== "active — SIMULATED") throw new ConflictException("A practice mandate must be active first.");
        await r.orderService.approve(r.orderId!, r.staffId, "Sandbox pickup");
        detail = "The actual order-approval service created three installments, consumed test credit and posted balanced ledger entries. As in production, approval required the (here simulated) mandate to be active first.";
        break;
      case 5:
        await r.orderService.updateStatus(r.orderId!, "delivered", r.staffId);
        detail = "The actual fulfilment service marked the test order delivered and completed its stock reservation.";
        break;
      case 6: {
        const [first] = await this.schedules(r); r.asOf = first.dueDate.toISOString();
        await this.receive(r, "practice-collection-1", first.amountKobo);
        await this.receive(r, "practice-collection-1", first.amountKobo);
        detail = "A simulated successful collection was posted through WalletService. The same synthetic event was delivered twice; only one repayment was recorded. No bank debit occurred.";
        break;
      }
      case 7: {
        const rows = await this.schedules(r); r.asOf = rows[1].dueDate.toISOString();
        detail = "A simulated second collection failed. No repayment was posted. Its amount remains owed and future installments stay scheduled.";
        break;
      }
      case 8: {
        const rows = await this.schedules(r);
        r.asOf = new Date(rows[rows.length - 1].dueDate.getTime() + 2 * 86_400_000).toISOString();
        detail = "The scenario clock advanced past the final due date. The missed second and third installments are now recovery eligible under our policy. No sweep instruction was sent.";
        break;
      }
      case 9:
        await this.receive(r, "practice-recovery-partial", 1_000_000n);
        detail = "A simulated ₦10,000 recovery was allocated to the oldest unpaid installment through the real repayment and ledger service. The remaining debt stays open.";
        break;
      case 10: {
        const rows = await this.schedules(r);
        const remaining = rows.reduce((sum, row) => sum + row.amountKobo - row.amountPaidKobo, 0n);
        await this.receive(r, "practice-recovery-final", remaining);
        r.mandate = "closed — SIMULATED";
        detail = "A simulated final recovery cleared the remaining debt. The schedule is fully paid and test credit is restored. The practice mandate is closed locally; no Recova cancellation or live payment occurred.";
        break;
      }
    }
    r.events.push({ title: JOURNEY_STEPS[r.next], detail, source, at: r.asOf });
    r.next++;
  }

  private async view(r: Run) {
    const rows = await this.schedules(r);
    const [application] = r.applicationId ? await r.db.select().from(applications).where(eq(applications.id, r.applicationId)) : [];
    const [credit] = r.userId ? await r.db.select().from(creditProfiles).where(eq(creditProfiles.userId, r.userId)) : [];
    const [order] = r.orderId ? await r.db.select().from(orders).where(eq(orders.id, r.orderId)) : [];
    const paid = await r.db.select().from(repayments);
    const ledger = await r.db.select().from(ledgerEntries);
    const debit = ledger.filter((e) => e.direction === "D").reduce((sum, e) => sum + e.amountKobo, 0n);
    const creditTotal = ledger.filter((e) => e.direction === "C").reduce((sum, e) => sum + e.amountKobo, 0n);
    return {
      started: true, id: r.id, steps: JOURNEY_STEPS, completedSteps: r.next, complete: r.next === JOURNEY_STEPS.length,
      nextStep: JOURNEY_STEPS[r.next] ?? null, error: r.error ?? null,
      mode: "isolated_workflow_practice", providerTransactions: 0,
      customer: { name: "Sandbox Customer — Practice Only", id: r.userId ?? null },
      application: application ? { id: application.id, reference: application.reference, status: application.status } : null,
      credit: credit ? { limitNaira: Number(credit.creditLimitKobo) / 100, usedNaira: Number(credit.usedCreditKobo) / 100 } : null,
      order: order ? { id: order.id, status: order.status, totalNaira: Number(order.totalKobo) / 100 } : null,
      mandate: r.mandate, asOf: r.asOf, events: r.events,
      installments: rows.map((row) => ({ number: row.installmentNumber, dueDate: row.dueDate.toISOString(), amountNaira: Number(row.amountKobo) / 100, paidNaira: Number(row.amountPaidKobo) / 100, isPaid: row.isPaid })),
      policy: rows.length ? previewRepayment({ asOf: r.asOf, installments: rows.map((row) => ({ dueDate: row.dueDate.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }), amountKobo: Number(row.amountKobo), paidKobo: Number(row.amountPaidKobo) })) }) : null,
      accounting: { repaymentCount: paid.length, receivedNaira: Number(paid.reduce((sum, p) => sum + p.amountKobo, 0n)) / 100, ledgerBalanced: debit === creditTotal },
    };
  }
}
