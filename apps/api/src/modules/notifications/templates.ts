// Plain, dependency-free templated strings. Keep them short and literal —
// this isn't a marketing surface.

function wrap(body: string): string {
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0D2119;line-height:1.6">
${body}
<p style="margin-top:24px;color:#7A9D8C;font-size:13px">— Farmer Market</p>
</div>`;
}

export const emails = {
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
