// Plain, dependency-free templated strings. Keep them short and literal —
// this isn't a marketing surface.

import { customerLinks } from "./links";

function wrap(body: string): string {
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0D2119;line-height:1.6">
${body}
<p style="margin-top:24px;color:#7A9D8C;font-size:13px">— Farmer Market · reply to this email and it reaches us at admin@farmermarket.ng</p>
</div>`;
}

// Several of the values below are free text someone typed into a form — a
// reviewer's note, a rejection reason, a delivery address, a person's name.
// They land inside HTML, so they get escaped: an angle bracket in a name
// shouldn't be able to inject markup into the recipient's mail client.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One obvious destination per email. Styled as an <a> rather than a <button>
// because mail clients strip most button markup; everything is inline for the
// same reason. The bare URL is repeated underneath so the link survives a
// client that renders the button as nothing.
function cta(href: string, label: string): string {
  return `<p style="margin-top:24px;margin-bottom:4px">
  <a href="${href}" style="display:inline-block;background:#0D2119;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${label}</a>
</p>
<p style="margin:0;color:#7A9D8C;font-size:12px;word-break:break-all">${href}</p>`;
}

export const emails = {
  // ── Account ───────────────────────────────────────────────────────────
  welcome: (name: string) => ({
    subject: "Welcome to Farmer Market",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Your Farmer Market account is set up. Next: complete verification so you can check out on credit — we'll walk you through it.</p>` +
        cta(customerLinks.apply(), "Complete verification"),
    ),
  }),

  // ── Credit application ────────────────────────────────────────────────
  applicationReceived: (name: string, opts: { reference: string; requestedLimit: string }) => ({
    subject: `We've received your application (${opts.reference})`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Thanks for applying for a Farmer Market credit limit of <strong>${esc(opts.requestedLimit)}</strong>.</p>` +
        `<p>Reference: <strong>${esc(opts.reference)}</strong>. Our team will review it and email you the decision.</p>` +
        cta(customerLinks.account(), "View my account"),
    ),
  }),
  applicationApproved: (name: string, opts: { reference: string; approvedLimit: string }) => ({
    subject: `Your application is approved (${opts.reference})`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Good news — application <strong>${esc(opts.reference)}</strong> is approved with a credit limit of <strong>${esc(opts.approvedLimit)}</strong>.</p>` +
        `<p>You can start shopping now. Each order still gets a quick approval before it's released for collection.</p>` +
        cta(customerLinks.marketplace(), "Start shopping"),
    ),
  }),
  applicationDeclined: (name: string, opts: { reference: string; note?: string }) => ({
    subject: `About your application (${opts.reference})`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>We couldn't approve application <strong>${esc(opts.reference)}</strong> at this time.</p>` +
        (opts.note
          ? `<blockquote style="border-left:3px solid #E5484D;padding-left:12px;color:#3A5E4B">${esc(opts.note)}</blockquote>`
          : "") +
        `<p>Reply to this email if you'd like to talk it through.</p>` +
        cta(customerLinks.account(), "View my account"),
    ),
  }),

  // ── Order ────────────────────────────────────────────────────────────
  orderReceived: (
    name: string,
    opts: { orderId: string; total: string; pickupCenter: string; pickupDate?: string | null },
  ) => ({
    subject: "We've got your order",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Your order of <strong>${esc(opts.total)}</strong> is in. It's awaiting a quick approval — we'll email you the moment it's confirmed.</p>` +
        `<p>Collect from: <strong>${esc(opts.pickupCenter)}</strong>${
          opts.pickupDate ? `<br/>Pickup date: <strong>${esc(opts.pickupDate)}</strong>` : ""
        }</p>` +
        cta(customerLinks.order(opts.orderId), "Track this order"),
    ),
  }),

  // ── Repayment ────────────────────────────────────────────────────────
  repaymentReceived: (
    name: string,
    opts: { amount: string; installmentNumber: number; totalInstallments: number; fullyPaid: boolean },
  ) => ({
    subject: "Repayment received",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>We've recorded your repayment of <strong>${esc(opts.amount)}</strong> ` +
        `(installment ${opts.installmentNumber} of ${opts.totalInstallments}).</p>` +
        `<p>${opts.fullyPaid ? "This installment is now fully paid. Thank you!" : "Thanks — it's been applied to your balance."}</p>` +
        cta(customerLinks.repayments(), "View my repayments"),
    ),
  }),
  repaymentReminder: (
    name: string,
    opts: {
      amount: string;
      dueLabel: string; // "tomorrow" | "today"
      dueDate: string; // "12 Sep 2026"
      installmentNumber: number;
      totalInstallments: number;
    },
  ) => ({
    subject: `Reminder: ${opts.amount} due ${opts.dueLabel}`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>A quick reminder that installment ${opts.installmentNumber} of ${opts.totalInstallments}` +
        ` — <strong>${esc(opts.amount)}</strong> — is due <strong>${esc(opts.dueLabel)}</strong> (${esc(opts.dueDate)}).</p>` +
        `<p>If you've already paid, thank you — you can ignore this.</p>` +
        cta(customerLinks.repayments(), "Make a payment"),
    ),
  }),
  repaymentOverdue: (
    name: string,
    opts: {
      amount: string;
      daysPastDue: number;
      installmentNumber: number;
      totalInstallments: number;
      severe: boolean; // 30+ days — a different call to action
    },
  ) => ({
    subject:
      opts.daysPastDue >= 30
        ? `Your account needs attention — ${opts.amount} overdue`
        : `${opts.amount} is now overdue`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Installment ${opts.installmentNumber} of ${opts.totalInstallments}` +
        ` — <strong>${esc(opts.amount)}</strong> — is <strong>${opts.daysPastDue} ${opts.daysPastDue === 1 ? "day" : "days"} overdue</strong>.</p>` +
        (opts.severe
          ? `<p>Please reply to this email or contact us so we can work out a plan. Continued non-payment affects your credit standing and future limit.</p>`
          : `<p>Please pay as soon as you can to keep your account in good standing.</p>`) +
        cta(customerLinks.repayments(), "Make a payment"),
    ),
  }),

  // ── Auto-debit ───────────────────────────────────────────────────────
  autoDebitFailed: (
    name: string,
    opts: { amount: string; installmentNumber: number; totalInstallments: number; reason: string; willRetry: boolean },
  ) => ({
    subject: `We couldn't collect ${opts.amount} from your account`,
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>We tried to collect installment ${opts.installmentNumber} of ${opts.totalInstallments}` +
        ` — <strong>${esc(opts.amount)}</strong> — from your bank account, but ${esc(opts.reason)}.</p>` +
        (opts.willRetry
          ? `<p>We'll try again automatically, so please make sure the money is in the account. Or you can pay it yourself now:</p>`
          : `<p>We won't retry automatically, so please pay this installment yourself as soon as you can:</p>`) +
        cta(customerLinks.repayments(), "Make a payment"),
    ),
  }),
  autoDebitNeedsReview: (name: string, opts: { amount: string }) => ({
    subject: "We're checking a payment from your account",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>A debit of <strong>${esc(opts.amount)}</strong> from your bank account needs a manual check on our side. ` +
        `We'll sort it out and email you — you don't need to do anything, and please don't pay this installment again until we do.</p>`,
    ),
  }),

  // ── Verification ─────────────────────────────────────────────────────
  verificationSubmitted: (name: string) => ({
    subject: "We've received your verification",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Thanks — we've got your details and documents. A reviewer will check them shortly and we'll email you as soon as it's done.</p>` +
        cta(customerLinks.account(), "Check my status"),
    ),
  }),
  verificationNeedsInfo: (name: string, note: string) => ({
    subject: "A bit more needed to verify your account",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>We looked at your verification and need another look at a few things:</p><blockquote style="border-left:3px solid #F5A623;padding-left:12px;color:#3A5E4B">${esc(note)}</blockquote><p>Update the details below and re-submit — it only takes a minute.</p>` +
        cta(customerLinks.apply(), "Update my details"),
    ),
  }),
  verified: (name: string) => ({
    subject: "You're verified 🎉",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Your account is verified. You can now check out — each order still gets a quick approval before it's released for collection.</p>` +
        cta(customerLinks.marketplace(), "Start shopping"),
    ),
  }),
  bankLinkRequested: (name: string) => ({
    subject: "Speed up your verification — link your salary account",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>A credit officer reviewing your application asked us to reach out: linking your ` +
        `salary account lets us verify your income automatically, which can speed up your decision.</p>` +
        `<p>It's optional and read-only — we can't move money from it. Your account page has a ` +
        `"Link your salary account" button.</p>` +
        cta(customerLinks.account(), "Link my salary account"),
    ),
  }),
  orderApproved: (
    name: string,
    opts: {
      orderId: string;
      total: string;
      deliverySlot?: string | null;
      pickupCenter: string;
      pickupDate?: string | null;
    },
  ) => ({
    subject: "Your order is approved",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>Your order of <strong>${esc(opts.total)}</strong> has been approved.</p>` +
        `<p>Collect from: <strong>${esc(opts.pickupCenter)}</strong><br/>${
          opts.deliverySlot
            ? `Expected: <strong>${esc(opts.deliverySlot)}</strong>`
            : opts.pickupDate
              ? `Pickup date: <strong>${esc(opts.pickupDate)}</strong>`
              : "We'll confirm a collection time shortly."
        }</p>` +
        cta(customerLinks.order(opts.orderId), "Track this order"),
    ),
  }),
  orderRejected: (name: string, opts: { orderId: string; reason: string }) => ({
    subject: "About your recent order",
    html: wrap(
      `<p>Hi ${esc(name)},</p><p>We couldn't approve your recent order.</p><blockquote style="border-left:3px solid #E5484D;padding-left:12px;color:#3A5E4B">${esc(opts.reason)}</blockquote><p>Nothing has been charged to your credit. You're welcome to try again.</p>` +
        cta(customerLinks.order(opts.orderId), "View this order"),
    ),
  }),
};
