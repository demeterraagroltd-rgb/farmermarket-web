// Plain, dependency-free templated strings. Keep them short and literal —
// this isn't a marketing surface.

function wrap(body: string): string {
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0D2119;line-height:1.6">
${body}
<p style="margin-top:24px;color:#7A9D8C;font-size:13px">— Demeterra · reply to this email and it reaches us at admin@demeterra.ng</p>
</div>`;
}

export const emails = {
  // ── Account ───────────────────────────────────────────────────────────
  welcome: (name: string) => ({
    subject: "Welcome to Demeterra",
    html: wrap(
      `<p>Hi ${name},</p><p>Your Demeterra account is set up. Next: complete verification so you can check out on credit — we'll walk you through it in the app.</p>`,
    ),
  }),

  // ── Credit application ────────────────────────────────────────────────
  applicationReceived: (name: string, opts: { reference: string; requestedLimit: string }) => ({
    subject: `We've received your application (${opts.reference})`,
    html: wrap(
      `<p>Hi ${name},</p><p>Thanks for applying for a Demeterra credit limit of <strong>${opts.requestedLimit}</strong>.</p>` +
        `<p>Reference: <strong>${opts.reference}</strong>. Our team will review it and email you the decision.</p>`,
    ),
  }),
  applicationApproved: (name: string, opts: { reference: string; approvedLimit: string }) => ({
    subject: `Your application is approved (${opts.reference})`,
    html: wrap(
      `<p>Hi ${name},</p><p>Good news — application <strong>${opts.reference}</strong> is approved with a credit limit of <strong>${opts.approvedLimit}</strong>.</p>` +
        `<p>You can start shopping now. Each order still gets a quick approval before delivery.</p>`,
    ),
  }),
  applicationDeclined: (name: string, opts: { reference: string; note?: string }) => ({
    subject: `About your application (${opts.reference})`,
    html: wrap(
      `<p>Hi ${name},</p><p>We couldn't approve application <strong>${opts.reference}</strong> at this time.</p>` +
        (opts.note
          ? `<blockquote style="border-left:3px solid #E5484D;padding-left:12px;color:#3A5E4B">${opts.note}</blockquote>`
          : "") +
        `<p>Reply to this email if you'd like to talk it through.</p>`,
    ),
  }),

  // ── Order ────────────────────────────────────────────────────────────
  orderReceived: (name: string, opts: { total: string; address: string }) => ({
    subject: "We've got your order",
    html: wrap(
      `<p>Hi ${name},</p><p>Your order of <strong>${opts.total}</strong> is in. It's awaiting a quick approval — we'll email you the moment it's confirmed.</p>` +
        `<p>Delivery to: ${opts.address}</p>`,
    ),
  }),

  // ── Repayment ────────────────────────────────────────────────────────
  repaymentReceived: (
    name: string,
    opts: { amount: string; installmentNumber: number; totalInstallments: number; fullyPaid: boolean },
  ) => ({
    subject: "Repayment received",
    html: wrap(
      `<p>Hi ${name},</p><p>We've recorded your repayment of <strong>${opts.amount}</strong> ` +
        `(installment ${opts.installmentNumber} of ${opts.totalInstallments}).</p>` +
        `<p>${opts.fullyPaid ? "This installment is now fully paid. Thank you!" : "Thanks — it's been applied to your balance."}</p>`,
    ),
  }),

  // ── Verification ─────────────────────────────────────────────────────
  verificationSubmitted: (name: string) => ({
    subject: "We've received your verification",
    html: wrap(
      `<p>Hi ${name},</p><p>Thanks — we've got your details and documents. A reviewer will check them shortly and we'll email you as soon as it's done.</p>`,
    ),
  }),
  verificationNeedsInfo: (name: string, note: string) => ({
    subject: "A bit more needed to verify your account",
    html: wrap(
      `<p>Hi ${name},</p><p>We looked at your verification and need another look at a few things:</p><blockquote style="border-left:3px solid #F5A623;padding-left:12px;color:#3A5E4B">${note}</blockquote><p>Open the app, update the details, and re-submit.</p>`,
    ),
  }),
  verified: (name: string) => ({
    subject: "You're verified 🎉",
    html: wrap(
      `<p>Hi ${name},</p><p>Your account is verified. You can now check out — each order still gets a quick approval before delivery.</p>`,
    ),
  }),
  orderApproved: (name: string, opts: { total: string; deliverySlot?: string | null; address: string }) => ({
    subject: "Your order is approved",
    html: wrap(
      `<p>Hi ${name},</p><p>Your order of <strong>${opts.total}</strong> has been approved.</p>` +
        `<p>Delivery to: ${opts.address}<br/>${opts.deliverySlot ? `Expected: <strong>${opts.deliverySlot}</strong>` : "We'll confirm a delivery time shortly."}</p>`,
    ),
  }),
  orderRejected: (name: string, reason: string) => ({
    subject: "About your recent order",
    html: wrap(
      `<p>Hi ${name},</p><p>We couldn't approve your recent order.</p><blockquote style="border-left:3px solid #E5484D;padding-left:12px;color:#3A5E4B">${reason}</blockquote><p>Nothing has been charged to your credit. You're welcome to try again.</p>`,
    ),
  }),
};
