import { Body, Controller, Headers, HttpCode, Inject, Logger, Post, UnauthorizedException, NotFoundException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { applicantProfiles, recovaCallbacks, recovaConsents, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SMS_SENDER, type SmsSender } from "../integrations/sms/sms.types";
import { RecovaConsentService } from "./recova-consent.service";

const baseSchema = z.object({ loanReference: z.string().regex(/^fm-live-[a-f0-9-]{36}$/), institutionCode: z.string().min(1).max(20) });
const smsSchema = baseSchema.extend({ phoneNumber: z.string().regex(/^\+?\d{10,15}$/), message: z.string().min(1).max(2000) }).strict();
const mandateSchema = baseSchema.strict();
const log = new Logger("RecovaWebhook");
/** Rejections are logged with a reason (never the header value) so a provider's
 * 401 can be diagnosed from the server logs. */
export function authenticateRecovaCallback(secret: string | undefined, route = "callback") {
  const expected = process.env.RECOVA_WEBHOOKS_ENABLED === "true" ? process.env.RECOVA_WEBHOOK_SECRET : undefined;
  const reject = (reason: string) => {
    log.warn(`Rejected Recova ${route} webhook (401): ${reason}`);
    throw new UnauthorizedException();
  };
  if (!expected || expected.length < 32) reject("webhooks are disabled or RECOVA_WEBHOOK_SECRET is not configured on this server");
  if (secret === undefined) reject("x-recova-webhook-secret header is missing");
  if (secret!.trim() === "") reject("x-recova-webhook-secret header is empty");
  const a = Buffer.from(secret!), b = Buffer.from(expected!);
  if (a.length !== b.length || !timingSafeEqual(a, b)) reject("x-recova-webhook-secret header does not match");
}
const phone = (value: string) => value.replace(/^\+/, "").replace(/^0(?=\d{10}$)/, "234");

/** The shared-secret header is our proposed contract, not a documented Recova
 * guarantee. Both routes remain disabled until the provider agrees to it. */
@ApiExcludeController()
@Controller("webhooks/recova")
export class RecovaWebhookController {
  constructor(@Inject(DB) private readonly db: Db, private readonly consent: RecovaConsentService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender) {}

  private async known(reference: string, institution: string) {
    if (institution !== process.env.RECOVA_PRODUCTION_INSTITUTION_CODE) throw new UnauthorizedException();
    const [row] = await this.db.select().from(recovaConsents).where(eq(recovaConsents.reference, reference)).limit(1);
    if (!row || row.status === "draft") throw new NotFoundException("Submitted consent reference not found.");
    return row;
  }

  @Post("sms")
  @HttpCode(200)
  async sendSms(@Headers("x-recova-webhook-secret") secret: string | undefined,
    @Body(new ZodValidationPipe(smsSchema)) body: z.infer<typeof smsSchema>) {
    authenticateRecovaCallback(secret, "sms");
    const row = await this.known(body.loanReference, body.institutionCode);
    const [profile] = await this.db.select({ phone: applicantProfiles.phone }).from(applicantProfiles).where(eq(applicantProfiles.userId, row.userId)).limit(1);
    if (!profile || phone(profile.phone) !== phone(body.phoneNumber)) throw new UnauthorizedException("Recipient does not match the loan customer.");
    if (!this.sms.live) throw new ServiceUnavailableException("Live SMS delivery is not configured.");
    const eventKey = createHash("sha256").update(JSON.stringify([body.loanReference, phone(body.phoneNumber), body.message])).digest("hex");
    const [receipt] = await this.db.insert(recovaCallbacks).values({ eventKey, reference: row.reference, kind: "sms", outcome: "sending" })
      .onConflictDoNothing().returning();
    if (!receipt) {
      const [previous] = await this.db.select().from(recovaCallbacks).where(eq(recovaCallbacks.eventKey, eventKey));
      if (previous?.outcome !== "delivered") throw new ConflictException("SMS delivery is unconfirmed; staff review is required. The consent link remains available in the customer's account.");
      return { ok: true, duplicate: true };
    }
    try {
      await this.sms.send(phone(profile.phone), body.message);
      await this.db.update(recovaCallbacks).set({ outcome: "delivered" }).where(eq(recovaCallbacks.eventKey, eventKey));
      return { ok: true };
    } catch {
      await this.db.update(recovaCallbacks).set({ outcome: "needs_review" }).where(eq(recovaCallbacks.eventKey, eventKey));
      throw new ServiceUnavailableException("SMS delivery is unconfirmed. Do not resend without checking delivery.");
    }
  }

  @Post("mandate-created")
  @HttpCode(200)
  async mandate(@Headers("x-recova-webhook-secret") secret: string | undefined,
    @Body(new ZodValidationPipe(mandateSchema)) body: z.infer<typeof mandateSchema>) {
    authenticateRecovaCallback(secret, "mandate-created");
    const row = await this.known(body.loanReference, body.institutionCode);
    // Re-read the mandate with our own bearer token. The callback cannot
    // activate a loan or disburse money merely by asserting that it exists.
    const status = await this.consent.refresh(row.userId, row.orderId);
    if (status.consent?.status !== "active") throw new ConflictException("The provider lookup has not confirmed an active mandate.");
    await this.db.insert(recovaCallbacks).values({ eventKey: `mandate-created:${row.reference}`, reference: row.reference, kind: "mandate-created", outcome: "verified" }).onConflictDoNothing();
    return { ok: true };
  }
}
