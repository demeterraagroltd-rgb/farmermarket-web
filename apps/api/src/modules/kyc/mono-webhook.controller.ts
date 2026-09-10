import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { webhookEvents, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { KycService } from "./kyc.service";

// Mono posts here when a linked account's data changes / is ready. Auth is
// the `mono-webhook-secret` header compared against MONO_WEBHOOK_SECRET
// (set the same value in the Mono dashboard). Dedup + replay protection via
// the unique `webhook_events.event_id`.
@ApiExcludeController()
@Controller("webhooks/mono")
export class MonoWebhookController {
  private readonly log = new Logger("MonoWebhook");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kyc: KycService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Headers("mono-webhook-secret") secret: string | undefined,
    @Body() body: MonoWebhookBody,
  ) {
    const expected = process.env.MONO_WEBHOOK_SECRET;
    if (!expected) {
      this.log.error("MONO_WEBHOOK_SECRET not set — rejecting webhook");
      throw new UnauthorizedException();
    }
    if (
      typeof secret !== "string" ||
      secret.length !== expected.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
    ) {
      throw new UnauthorizedException("Bad webhook secret");
    }

    const event = body?.event ?? "unknown";
    // Mono doesn't always send a stable id; fall back to a content hash-ish key.
    const eventId =
      body?.event_id ??
      `${event}:${accountIdOf(body) ?? "?"}:${body?.timestamp ?? Date.now()}`;

    // Replay/dup guard — the unique constraint does the work.
    try {
      await this.db.insert(webhookEvents).values({
        source: "mono",
        eventId,
        payload: body as unknown as Record<string, unknown>,
      });
    } catch {
      this.log.log(`duplicate webhook ${eventId} — ignoring`);
      return { ok: true, duplicate: true };
    }

    if (event === "mono.events.account_connected" || event === "mono.events.account_updated") {
      const accountId = accountIdOf(body);
      if (accountId) {
        // Fire-and-forget: Mono retries on a non-2xx, and the pull can be slow.
        void this.kyc
          .refreshBankAnalysisByAccount(accountId)
          .then(() =>
            this.db
              .update(webhookEvents)
              .set({ processedAt: new Date() })
              .where(eq(webhookEvents.eventId, eventId)),
          )
          .catch((e) => this.log.warn(`refresh for ${accountId} failed: ${e?.message ?? e}`));
      }
    }
    return { ok: true };
  }
}

interface MonoWebhookBody {
  event?: string;
  event_id?: string;
  timestamp?: string;
  data?: {
    id?: string;
    _id?: string;
    account?: { id?: string; _id?: string };
  };
}

function accountIdOf(body: MonoWebhookBody): string | null {
  const d = body?.data;
  return d?.account?.id ?? d?.account?._id ?? d?.id ?? d?._id ?? null;
}
