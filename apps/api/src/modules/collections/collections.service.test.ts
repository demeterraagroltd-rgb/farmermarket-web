import { describe, expect, it } from "vitest";
import { CollectionsService } from "./collections.service";
import { FakeSmsSender } from "../integrations/sms/fake.sms";

const DAY = 86_400_000;

interface Seed {
  scheduleId?: string;
  amountKobo?: bigint;
  amountPaidKobo?: bigint;
  dueInDays: number; // +1 = due tomorrow, -3 = 3 days overdue
  installmentNumber?: number;
  totalInstallments?: number;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
}

const NOW = new Date("2026-09-15T09:00:00Z");

function makeRows(seeds: Seed[]) {
  return seeds.map((s, i) => ({
    scheduleId: s.scheduleId ?? `sch-${i}`,
    userId: `usr-${i}`,
    amountKobo: s.amountKobo ?? 500000n, // ₦5,000
    amountPaidKobo: s.amountPaidKobo ?? 0n,
    dueDate: new Date(NOW.getTime() + s.dueInDays * DAY),
    installmentNumber: s.installmentNumber ?? 1,
    totalInstallments: s.totalInstallments ?? 3,
    buyerName: `Buyer ${i}`,
    buyerEmail: s.buyerEmail === undefined ? `buyer${i}@example.com` : s.buyerEmail,
    buyerPhone: s.buyerPhone === undefined ? `080000000${i}0` : s.buyerPhone,
    planName: "Pay Over 3 Months",
  }));
}

function fakeDb(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return { select: () => chain } as any;
}

function makeEmail() {
  const sent: Array<{ to: string; subject: string }> = [];
  return {
    sent,
    service: { send: async ({ to, subject }: { to: string; subject: string }) => void sent.push({ to, subject }) } as any,
  };
}

/** A stand-in for a real (live) SMS provider — records sends, reports live. */
function liveSms() {
  const sent: Array<{ to: string; message: string }> = [];
  return {
    sent,
    sender: { live: true, send: async (to: string, message: string) => void sent.push({ to, message }) } as any,
  };
}

describe("CollectionsService.run", () => {
  it("sends a reminder the day before and the day of the due date, nothing earlier", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: 1 }, { dueInDays: 0 }, { dueInDays: 3 }])),
      email.service,
      new FakeSmsSender(),
    );
    const res = await svc.run({ now: NOW });

    expect(res.remindersDue).toBe(2);
    expect(res.overdueNotices).toBe(0);
    expect(email.sent.map((e) => e.subject)).toEqual([
      expect.stringMatching(/due tomorrow/),
      expect.stringMatching(/due today/),
    ]);
  });

  it("chases overdue installments weekly — days 1 and 8, not day 3", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: -1 }, { dueInDays: -3 }, { dueInDays: -8 }])),
      email.service,
      new FakeSmsSender(),
    );
    const res = await svc.run({ now: NOW });

    expect(res.overdueNotices).toBe(2);
    expect(res.notices.filter((n) => n.kind === "overdue").map((n) => n.daysPastDue).sort((a, b) => a - b)).toEqual([
      1, 8,
    ]);
  });

  it("uses the severe copy past 30 days overdue", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: -36 }])), // 36 % 7 === 1, and >= 30
      email.service,
      new FakeSmsSender(),
    );
    await svc.run({ now: NOW });
    expect(email.sent[0].subject).toMatch(/needs attention/);
  });

  it("dry run reports what would go out but sends nothing", async () => {
    const email = makeEmail();
    const sms = liveSms();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: 1 }, { dueInDays: -8 }])),
      email.service,
      sms.sender,
    );
    const res = await svc.run({ now: NOW, dryRun: true });

    expect(res.notices).toHaveLength(2);
    expect(res.emailsSent).toBe(0);
    expect(res.smsSent).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
  });

  it("texts as well as emails when the SMS provider is live", async () => {
    const email = makeEmail();
    const sms = liveSms();
    const svc = new CollectionsService(fakeDb(makeRows([{ dueInDays: 1 }])), email.service, sms.sender);
    const res = await svc.run({ now: NOW });

    expect(res.emailsSent).toBe(1);
    expect(res.smsSent).toBe(1);
    expect(sms.sent[0].message).toMatch(/due tomorrow/);
    expect(res.notices[0].channels.sort()).toEqual(["email", "sms"]);
  });

  it("does not text when the SMS provider is only the dry-run fake", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(fakeDb(makeRows([{ dueInDays: 1 }])), email.service, new FakeSmsSender());
    const res = await svc.run({ now: NOW });
    expect(res.smsSent).toBe(0);
    expect(res.notices[0].channels).toEqual(["email"]);
  });

  it("skips a schedule that is flagged unpaid but has nothing owing", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: 1, amountKobo: 500000n, amountPaidKobo: 500000n }])),
      email.service,
      new FakeSmsSender(),
    );
    const res = await svc.run({ now: NOW });
    expect(res.notices).toHaveLength(0);
    expect(res.scannedUnpaid).toBe(1);
  });

  it("still counts a notice when the buyer has no contact details", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: 1, buyerEmail: null, buyerPhone: null }])),
      email.service,
      new FakeSmsSender(),
    );
    const res = await svc.run({ now: NOW });
    expect(res.remindersDue).toBe(1);
    expect(res.emailsSent).toBe(0);
    expect(res.notices[0].channels).toEqual([]);
  });

  it("reports the amount still owed, not the full installment", async () => {
    const email = makeEmail();
    const svc = new CollectionsService(
      fakeDb(makeRows([{ dueInDays: -1, amountKobo: 500000n, amountPaidKobo: 200000n }])),
      email.service,
      new FakeSmsSender(),
    );
    const res = await svc.run({ now: NOW });
    expect(res.notices[0].amountDue).toContain("3,000"); // ₦5,000 − ₦2,000 paid
  });
});
