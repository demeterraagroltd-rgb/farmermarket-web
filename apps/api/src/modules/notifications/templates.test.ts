import { afterEach, describe, expect, it } from "vitest";
import { emails } from "./templates";
import { customerLinks } from "./links";

// Requirement: every customer email links to the right place in the web app,
// and the link has to be absolute — an email client has no origin to resolve a
// relative path against, so "/account" would silently go nowhere.
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

const SAMPLES: Array<{ name: string; email: { subject: string; html: string } }> = [
  { name: "welcome", email: emails.welcome("Ada") },
  {
    name: "applicationReceived",
    email: emails.applicationReceived("Ada", { reference: "APP-1", requestedLimit: "₦150,000" }),
  },
  {
    name: "applicationApproved",
    email: emails.applicationApproved("Ada", { reference: "APP-1", approvedLimit: "₦150,000" }),
  },
  { name: "applicationDeclined", email: emails.applicationDeclined("Ada", { reference: "APP-1", note: "Thin file" }) },
  {
    name: "orderReceived",
    email: emails.orderReceived("Ada", {
      orderId: "o-1",
      total: "₦5,000",
      pickupCenter: "FCDA Secretariat",
      pickupDate: "25 Sep 2026",
    }),
  },
  {
    name: "repaymentReceived",
    email: emails.repaymentReceived("Ada", { amount: "₦5,000", installmentNumber: 1, totalInstallments: 3, fullyPaid: true }),
  },
  {
    name: "repaymentReminder",
    email: emails.repaymentReminder("Ada", {
      amount: "₦5,000",
      dueLabel: "tomorrow",
      dueDate: "12 Sep 2026",
      installmentNumber: 1,
      totalInstallments: 3,
    }),
  },
  {
    name: "repaymentOverdue",
    email: emails.repaymentOverdue("Ada", {
      amount: "₦5,000",
      daysPastDue: 3,
      installmentNumber: 1,
      totalInstallments: 3,
      severe: false,
    }),
  },
  { name: "verificationSubmitted", email: emails.verificationSubmitted("Ada") },
  { name: "verificationNeedsInfo", email: emails.verificationNeedsInfo("Ada", "NIN unreadable") },
  { name: "verified", email: emails.verified("Ada") },
  { name: "bankLinkRequested", email: emails.bankLinkRequested("Ada") },
  {
    name: "orderApproved",
    email: emails.orderApproved("Ada", {
      orderId: "o-1",
      total: "₦5,000",
      deliverySlot: "Tue 3 Sep",
      pickupCenter: "FCDA Secretariat",
      pickupDate: "25 Sep 2026",
    }),
  },
  { name: "orderRejected", email: emails.orderRejected("Ada", { orderId: "o-1", reason: "Limit exceeded" }) },
];

describe("customer emails", () => {
  afterEach(() => {
    delete process.env.WEB_BASE_URL;
  });

  it.each(SAMPLES)("$name carries exactly one absolute link", ({ email }) => {
    const found = hrefs(email.html);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^https?:\/\/[^/]+\//);
  });

  it("routes each email to the destination the customer needs", () => {
    expect(hrefs(emails.welcome("Ada").html)[0]).toBe(customerLinks.apply());
    expect(hrefs(emails.applicationApproved("Ada", { reference: "A", approvedLimit: "₦1" }).html)[0]).toBe(
      customerLinks.marketplace(),
    );
    expect(hrefs(emails.verified("Ada").html)[0]).toBe(customerLinks.marketplace());
    expect(hrefs(emails.verificationSubmitted("Ada").html)[0]).toBe(customerLinks.account());
    expect(hrefs(emails.verificationNeedsInfo("Ada", "n").html)[0]).toBe(customerLinks.apply());
    expect(hrefs(emails.bankLinkRequested("Ada").html)[0]).toBe(customerLinks.account());
    expect(
      hrefs(emails.orderReceived("Ada", { orderId: "o-1", total: "₦1", pickupCenter: "x" }).html)[0],
    ).toBe(customerLinks.order("o-1"));
    expect(
      hrefs(emails.orderApproved("Ada", { orderId: "o-2", total: "₦1", pickupCenter: "x" }).html)[0],
    ).toBe(customerLinks.order("o-2"));
    expect(hrefs(emails.orderRejected("Ada", { orderId: "o-3", reason: "r" }).html)[0]).toBe(
      customerLinks.order("o-3"),
    );
    expect(
      hrefs(
        emails.repaymentReminder("Ada", {
          amount: "₦1",
          dueLabel: "today",
          dueDate: "12 Sep 2026",
          installmentNumber: 1,
          totalInstallments: 1,
        }).html,
      )[0],
    ).toBe(customerLinks.repayments());
    expect(
      hrefs(
        emails.repaymentOverdue("Ada", {
          amount: "₦1",
          daysPastDue: 40,
          installmentNumber: 1,
          totalInstallments: 1,
          severe: true,
        }).html,
      )[0],
    ).toBe(customerLinks.repayments());
  });

  it("honours WEB_BASE_URL, so a staging deploy doesn't email production links", () => {
    process.env.WEB_BASE_URL = "https://staging.example.test/";
    expect(customerLinks.account()).toBe("https://staging.example.test/account");
    expect(hrefs(emails.verified("Ada").html)[0]).toBe("https://staging.example.test/marketplace");
  });

  it("escapes free text, so a name can't inject markup into the mail client", () => {
    const html = emails.orderRejected("<img src=x onerror=alert(1)>", {
      orderId: "o-1",
      reason: 'a "quoted" <script>',
    }).html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("URL-encodes an order id, so a stray slash can't point the link elsewhere", () => {
    expect(customerLinks.order("a/b")).toContain("/orders/a%2Fb");
    expect(customerLinks.order("a/b")).not.toContain("/orders/a/b");
  });
});
