import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import * as argon2 from "argon2";
import { canonicalLga, isValidStateLgaPair, nairaToKobo } from "@farmermarket/core";
import {
  applicantProfiles,
  auditLogs,
  bankAccounts,
  creditProfiles,
  kycDocuments,
  kycEvents,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { decryptSecretOrNull, encryptSecret, hasEncryptionKey } from "../../common/crypto/reversible-secret";
import { JwtService } from "@nestjs/jwt";
import {
  destroyAsset,
  signedDownloadUrl,
  uploadPrivateBuffer,
} from "../../common/cloudinary";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import { OtpService } from "../auth/otp.service";
import { MONO_CLIENT, type MonoClient } from "../integrations/mono/mono.types";
import {
  LOOKUP_CLIENT,
  type IdentityRecord,
  type LookupClient,
} from "../integrations/mono-lookup/lookup.types";
import type { BankAnalysis } from "./bank-analysis";
import { MonoSyncService } from "../mono-data/mono-sync.service";
import { consecutiveFailures, decideRefresh } from "../mono-data/refresh-policy";
import { recordIdentityVerification } from "../mono-data/identity-verifications";
import { matchIdentity } from "./identity-match";
import type {
  RegisterInput,
  UpdateKycInput,
  ReviewDocumentInput,
  StaffProfileEditInput,
  VerifyKycInput,
} from "./dto/kyc.dto";

const CUSTOMER_ACCESS_TOKEN_TTL = "30d";

// A profile is ready to submit for verification once these are present.
// NIN used to be deferrable; it no longer is — Mashup needs it alongside the
// BVN for the no-consent identity check, so it's required from here on.
// Employment details are required too: they're the inputs to income
// verification and the scorecard (§8), and a file without them can't be
// underwritten at all. Employment *documents* stay deferrable.
const REQUIRED_PROFILE_FIELDS: (keyof typeof applicantProfiles.$inferSelect)[] = [
  "fullName",
  "dateOfBirth",
  "bvnHash",
  "nin",
  "residentialAddress",
  "stateOfOrigin",
  "lgaOfOrigin",
  "employmentType",
  "employer",
  "jobTitle",
  "netMonthlySalaryKobo",
];
const ID_DOC_KINDS = ["id_card", "passport", "drivers_license"] as const;

// Mono gives a BVN consent session ~10 minutes; expire ours no later than
// that so a stale session fails with our wording rather than theirs.
const BVN_CONSENT_TTL_MS = 10 * 60 * 1000;
// Same cooldown as the SMS OTP flow (OtpService.RESEND_COOLDOWN_MS) — one
// resend per minute. Without this, a user tapping resend repeatedly fires a
// real request to Mono/NIBSS on every tap, which costs money on the real
// client and can read as abuse to NIBSS.
const BVN_OTP_RESEND_COOLDOWN_MS = 60 * 1000;


type ProfileWrite = Partial<typeof applicantProfiles.$inferInsert>;

@Injectable()
export class KycService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly otp: OtpService,
    @Inject(MONO_CLIENT) private readonly mono: MonoClient,
    @Inject(LOOKUP_CLIENT) private readonly lookup: LookupClient,
    private readonly monoSync: MonoSyncService,
  ) {}

  /**
   * In-flight BVN consent sessions, keyed by user id. In memory on purpose:
   * they die in 10 minutes, they're worthless once spent, and a restart
   * losing them just means the applicant asks for a new code. If the API
   * ever runs more than one instance this needs to move to Redis — a
   * follow-up leg would otherwise land on a process that never saw stage 1.
   */
  private readonly bvnConsents = new Map<
    string,
    { sessionId: string; expiresAt: number; lastOtpSentAt: number | null }
  >();

  // ── Registration ────────────────────────────────────────────────────────

  async register(input: RegisterInput) {
    // No account without a proven phone number (§9 — Termii). Throws a
    // human 400 if the token is missing, stale, or for a different number.
    await this.otp.assertPhoneVerified(input.phoneVerificationToken, input.phone, "register");

    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.phone, input.phone)).limit(1);
      if (existing?.passwordHash) {
        throw new BadRequestException("An account with this phone number already exists — please log in");
      }

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const now = new Date();
      let user = existing;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            phone: input.phone,
            fullName: input.fullName,
            email: input.email,
            passwordHash,
            phoneVerifiedAt: now,
          })
          .returning();
      } else {
        [user] = await tx
          .update(users)
          .set({
            fullName: input.fullName,
            email: input.email,
            passwordHash,
            phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
            updatedAt: now,
          })
          .where(eq(users.id, user.id))
          .returning();
      }

      const write = await this.toProfileWrite(input);
      await tx
        .insert(applicantProfiles)
        .values({
          ...write,
          userId: user.id,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
        })
        .onConflictDoUpdate({ target: applicantProfiles.userId, set: { ...write, updatedAt: new Date() } });

      return user;
    });

    void this.email.send({ to: result.email, ...emails.welcome(result.fullName ?? "there") });

    const accessToken = this.jwt.sign(
      { sub: result.id, kind: "customer" },
      { expiresIn: CUSTOMER_ACCESS_TOKEN_TTL },
    );
    const profile = await this.getProfileRow(result.id);
    return {
      accessToken,
      userId: result.id,
      fullName: result.fullName,
      verificationStatus: profile.verificationStatus,
      hasTxnPin: false,
    };
  }

  // ── Buyer: my KYC ───────────────────────────────────────────────────────

  async getMyKyc(userId: string) {
    const profile = await this.getProfileRow(userId);
    const docs = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.userId, userId), ne(kycDocuments.status, "superseded")))
      .orderBy(desc(kycDocuments.uploadedAt));
    return { profile: this.publicProfile(profile), documents: docs.map((d) => this.publicDoc(d)) };
  }

  async updateKyc(userId: string, input: UpdateKycInput) {
    await this.getProfileRow(userId); // 404 if no account
    const write = await this.toProfileWrite(input);
    if (Object.keys(write).length === 0) return this.getMyKyc(userId);
    await this.db
      .update(applicantProfiles)
      .set({ ...write, updatedAt: new Date() })
      .where(eq(applicantProfiles.userId, userId));
    return this.getMyKyc(userId);
  }

  /** Buyer taps "Submit for verification" at the end of the wizard. */
  async submitForVerification(userId: string) {
    const profile = await this.getProfileRow(userId);
    if (profile.verificationStatus === "verified") {
      throw new BadRequestException("You're already verified");
    }
    const missing = this.missingRequirements(profile);
    // Both pairs are checked against the merged profile rather than per-write,
    // because a partial PATCH can legitimately carry only one half. Reaching
    // here means the file is complete, so a pair that doesn't hold together is
    // stale or hand-rolled data — reject it rather than verify it.
    if (profile.stateOfOrigin && profile.lgaOfOrigin &&
        !isValidStateLgaPair(profile.stateOfOrigin, profile.lgaOfOrigin)) {
      missing.push("an LGA of origin that belongs to your state of origin (pick both from the lists)");
    }
    const addr = profile.residentialAddress as { state?: string; lga?: string } | null;
    if (addr?.state && addr?.lga && !isValidStateLgaPair(addr.state, addr.lga)) {
      missing.push("an LGA of residence that belongs to your state of residence (pick both from the lists)");
    }
    const docs = await this.db.select().from(kycDocuments).where(eq(kycDocuments.userId, userId));
    const hasId = docs.some((d) => (ID_DOC_KINDS as readonly string[]).includes(d.kind) && d.status !== "superseded");
    if (!hasId) missing.push("a government photo ID (ID card, passport, or driver's licence)");
    if (missing.length > 0) {
      throw new BadRequestException(`Still needed before we can verify you: ${missing.join("; ")}`);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(applicantProfiles)
        .set({ verificationStatus: "submitted", submittedAt: new Date(), verificationNote: null, updatedAt: new Date() })
        .where(eq(applicantProfiles.userId, userId));
      await tx.insert(kycEvents).values({
        userId,
        fromStatus: profile.verificationStatus,
        toStatus: "submitted",
      });
    });
    void this.email.send({ to: profile.email, ...emails.verificationSubmitted(profile.fullName) });
    // Fire-and-forget: BVN + NIN + DOB are all freshly on file the moment
    // submission succeeds, so this is the best chance to check them without
    // making the applicant wait on it. Never awaited into the response —
    // see autoVerifyIdentityOnSubmit for why it can't fail this call.
    void this.autoVerifyIdentityOnSubmit(userId);
    return this.getMyKyc(userId);
  }

  // ── Buyer: link a salary account (Mono Connect, §9.1) ───────────────────

  /**
   * Exchange a Connect widget `code` for a Mono account id, store it on the
   * profile, then pull income/statement data and write the analysis. The
   * pull runs inline (no worker yet); a Mono webhook re-runs it later if the
   * data wasn't ready at link time.
   */
  async linkBank(userId: string, code: string) {
    await this.getProfileRow(userId); // 404 if no account
    const { accountId } = await this.mono.exchangeToken(code);

    // Before recording anything: one bank account can't belong to two customers.
    await this.monoSync.assertAccountAvailable(userId, accountId);

    await this.db
      .update(applicantProfiles)
      .set({ monoAccountId: accountId, bankLinkedAt: new Date(), updatedAt: new Date() })
      .where(eq(applicantProfiles.userId, userId));

    const { analysis } = await this.monoSync.sync({ userId, monoAccountId: accountId, trigger: "link" });
    return { linked: true as const, analysisReady: analysis.source !== "unavailable", analysis };
  }

  /** Webhook path: Mono says an account's data changed — re-pull and re-store. */
  async refreshBankAnalysisByAccount(monoAccountId: string) {
    // Known by the bank_accounts table, or — for an account linked before that
    // table existed — by the legacy profile column.
    const [account] = await this.db
      .select({ userId: bankAccounts.userId })
      .from(bankAccounts)
      .where(eq(bankAccounts.monoAccountId, monoAccountId))
      .limit(1);
    const [profile] = account
      ? [{ userId: account.userId }]
      : await this.db
          .select({ userId: applicantProfiles.userId })
          .from(applicantProfiles)
          .where(eq(applicantProfiles.monoAccountId, monoAccountId))
          .limit(1);
    if (!profile) return; // an account we don't track — ignore
    await this.monoSync.sync({ userId: profile.userId, monoAccountId, trigger: "webhook" });
  }

  // ── Buyer: documents ────────────────────────────────────────────────────

  async uploadDocument(userId: string, kind: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!file?.buffer?.length) throw new BadRequestException("No file received");
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException("File is larger than 10 MB");

    const asset = await uploadPrivateBuffer(file.buffer, {
      folder: `farmer-market/kyc/${userId}`,
      publicId: `${kind}-${Date.now()}`,
    });

    return this.db.transaction(async (tx) => {
      // Supersede any earlier upload of the same kind that hasn't been accepted.
      await tx
        .update(kycDocuments)
        .set({ status: "superseded" })
        .where(
          and(
            eq(kycDocuments.userId, userId),
            eq(kycDocuments.kind, kind as typeof kycDocuments.kind.enumValues[number]),
            inArray(kycDocuments.status, ["pending", "rejected"]),
          ),
        );
      const [row] = await tx
        .insert(kycDocuments)
        .values({
          userId,
          kind: kind as typeof kycDocuments.kind.enumValues[number],
          cloudinaryPublicId: asset.publicId,
          cloudinaryResourceType: asset.resourceType,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        })
        .returning();
      return this.publicDoc(row);
    });
  }

  async deleteDocument(userId: string, docId: string) {
    const [doc] = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.id, docId), eq(kycDocuments.userId, userId)))
      .limit(1);
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "pending") throw new BadRequestException("This document has already been reviewed");
    await destroyAsset(doc.cloudinaryPublicId, doc.cloudinaryResourceType).catch(() => undefined);
    await this.db.delete(kycDocuments).where(eq(kycDocuments.id, docId));
    return { deleted: true };
  }

  // ── Staff ───────────────────────────────────────────────────────────────

  async listQueue() {
    const rows = await this.db
      .select()
      .from(applicantProfiles)
      .where(inArray(applicantProfiles.verificationStatus, ["submitted", "needs_more_info"]))
      .orderBy(applicantProfiles.submittedAt);
    const counts = await this.db
      .select({ userId: kycDocuments.userId, status: kycDocuments.status })
      .from(kycDocuments);
    return rows.map((p) => ({
      userId: p.userId,
      fullName: p.fullName,
      phone: p.phone,
      email: p.email,
      verificationStatus: p.verificationStatus,
      submittedAt: p.submittedAt,
      documentCount: counts.filter((c) => c.userId === p.userId && c.status !== "superseded").length,
      pendingDocuments: counts.filter((c) => c.userId === p.userId && c.status === "pending").length,
    }));
  }

  async getForStaff(staffId: string, userId: string, opts: { audit?: boolean } = {}) {
    const profile = await this.getProfileRow(userId);
    const docs = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.userId, userId), ne(kycDocuments.status, "superseded")))
      .orderBy(desc(kycDocuments.uploadedAt));
    const events = await this.db
      .select()
      .from(kycEvents)
      .where(eq(kycEvents.userId, userId))
      .orderBy(desc(kycEvents.createdAt));

    // The Customer 360 page records its own "customer.viewed" row and reads
    // this with { audit: false }, so opening one customer isn't logged twice.
    if (opts.audit !== false) {
      await this.db.insert(auditLogs).values({
        actorStaffId: staffId,
        action: "kyc.view",
        targetType: "user",
        targetId: userId,
      });
    }

    return {
      profile: { ...this.publicProfile(profile), bvnLast4: profile.bvnLast4 },
      documents: docs.map((d) => ({
        ...this.publicDoc(d),
        url: signedDownloadUrl(d.cloudinaryPublicId, d.cloudinaryResourceType),
      })),
      events,
    };
  }

  // ── Staff: correct declared facts / refresh bank data (Customer 360) ────

  /**
   * A staff member correcting the customer's *declared* application facts —
   * employment, address, household. Identity-defining fields aren't accepted
   * (see staffProfileEditSchema). Audited with what changed; for the plain
   * employment facts the old and new value, for address and next of kin only
   * that they changed, so the audit trail doesn't become a second copy of PII.
   */
  async updateProfileAsStaff(staffId: string, userId: string, input: StaffProfileEditInput) {
    const before = await this.getProfileRow(userId);
    const write = await this.toProfileWrite(input);
    if (Object.keys(write).length === 0) throw new BadRequestException("Nothing to change");

    await this.db
      .update(applicantProfiles)
      .set({ ...write, updatedAt: new Date() })
      .where(eq(applicantProfiles.userId, userId));

    const previous: Record<string, unknown> = {
      employmentType: before.employmentType,
      employer: before.employer,
      jobTitle: before.jobTitle,
      netMonthlySalaryNaira: before.netMonthlySalaryKobo == null ? null : Number(before.netMonthlySalaryKobo) / 100,
      salaryDay: before.salaryDay,
      yearsEmployed: before.yearsEmployed,
      maritalStatus: before.maritalStatus,
      dependantsCount: before.dependantsCount,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, to] of Object.entries(input)) {
      if (key in previous) changes[key] = { from: previous[key] ?? null, to };
    }
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.profile_edited",
      targetType: "user",
      targetId: userId,
      metadata: { fields: Object.keys(input), changes },
    });
    return this.getForStaff(staffId, userId, { audit: false });
  }

  /**
   * "Refresh bank data" from the admin screen: re-pull an already-linked
   * account. Never asks the customer to reconnect — the Mono account id is a
   * standing authorisation until they revoke it. If Mono returns nothing
   * usable the last good analysis is kept (see MonoSyncService).
   */
  async refreshBankDataForStaff(staffId: string, userId: string) {
    const profile = await this.getProfileRow(userId);
    if (!profile.monoAccountId) {
      throw new BadRequestException("This customer hasn't linked a bank account, so there's nothing to refresh.");
    }
    const [account] = await this.db
      .select({ id: bankAccounts.id, lastSyncedAt: bankAccounts.lastSyncedAt, lastSyncAttemptAt: bankAccounts.lastSyncAttemptAt })
      .from(bankAccounts)
      .where(eq(bankAccounts.monoAccountId, profile.monoAccountId))
      .limit(1);
    // A legacy/backfilled account can have a bank_analysis snapshot with no
    // bank_accounts row backing it at all yet — fall back to the snapshot's
    // own timestamp for the flood guard, same anchor the old cooldown used.
    const analysedAt = (profile.bankAnalysis as BankAnalysis | null)?.pulledAt;
    const lastSyncAttemptAt =
      account?.lastSyncAttemptAt ?? (analysedAt && Number.isFinite(Date.parse(analysedAt)) ? new Date(analysedAt) : null);

    const recent = account ? await this.monoSync.recentLogStatuses(account.id, 10) : [];
    const decision = decideRefresh({
      trigger: "admin",
      lastSyncedAt: account?.lastSyncedAt ?? null,
      lastSyncAttemptAt,
      lastSyncStatus: (recent[0]?.status as "success" | "partial" | "failed" | "skipped" | undefined) ?? null,
      consecutiveFailures: consecutiveFailures(recent),
    });

    if (!decision.shouldRefresh) {
      if (account) {
        await this.monoSync.logSkipped({
          userId,
          bankAccountId: account.id,
          monoAccountId: profile.monoAccountId,
          trigger: "admin",
          staffId,
          reason: `admin refresh declined: ${decision.reason}`,
        });
      }
      throw new HttpException(
        `Bank data was refreshed a moment ago — try again in ${decision.retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { analysis, preserved } = await this.monoSync.sync({
      userId,
      monoAccountId: profile.monoAccountId,
      trigger: "admin",
      staffId,
    });
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.bank_data_refreshed",
      targetType: "user",
      targetId: userId,
      metadata: { source: analysis.source, keptPreviousData: preserved },
    });
    return { refreshed: !preserved, keptPreviousData: preserved, analysis };
  }

  /**
   * A credit officer asks this applicant to link their salary account.
   * Reviewer-initiated by design — the wizard never shows it unprompted (an
   * unrequested "link your bank" ask reads as a phishing pattern to a real
   * applicant, and most applications are decided on documents alone anyway).
   */
  async requestBankLink(staffId: string, userId: string) {
    const profile = await this.getProfileRow(userId);
    if (profile.monoAccountId) {
      throw new BadRequestException("This applicant has already linked a bank account");
    }
    await this.db
      .update(applicantProfiles)
      .set({ bankLinkRequestedAt: new Date(), updatedAt: new Date() })
      .where(eq(applicantProfiles.userId, userId));
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "kyc.bank_link_requested",
      targetType: "user",
      targetId: userId,
    });
    void this.email.send({ to: profile.email, ...emails.bankLinkRequested(profile.fullName) });
    return this.getForStaff(staffId, userId);
  }

  // ── Identity verification (Mono Lookup, §9.1) ───────────────────────────

  /**
   * Stage 1 of BVN consent. Reuse the encrypted BVN on file server-side.
   * Older profiles holding only a hash must supply the number once more.
   *
   * The Mono session id stays server-side, keyed by user id: handing it to
   * the browser would let whoever holds it finish someone else's consent.
   */
  async startBvnLookup(userId: string, suppliedBvn?: string) {
    const profile = await this.getProfileRow(userId);
    const savedBvn = decryptSecretOrNull(profile.bvnEncrypted);
    const bvn = savedBvn ?? suppliedBvn;
    if (!bvn) {
      throw new BadRequestException("Please enter your BVN once more — the previously saved number cannot be recovered.");
    }
    if (profile.bvnHash && !(await argon2.verify(profile.bvnHash, bvn))) {
      throw new BadRequestException("That BVN doesn't match the one on your application");
    }
    const { sessionId, methods } = await this.lookup.initiateBvn(bvn);
    if (!savedBvn && profile.bvnHash && hasEncryptionKey()) {
      await this.db.update(applicantProfiles)
        .set({ bvnEncrypted: encryptSecret(bvn), updatedAt: new Date() })
        .where(eq(applicantProfiles.userId, userId));
    }
    this.bvnConsents.set(userId, { sessionId, expiresAt: Date.now() + BVN_CONSENT_TTL_MS, lastOtpSentAt: null });
    return {
      methods: methods.filter((m) => /^(phone(?:_\d+)?|sms)$/.test(m.method)),
      expiresInSeconds: BVN_CONSENT_TTL_MS / 1000,
      // So the UI can say "sandbox result" rather than implying NIBSS
      // confirmed anything.
      live: this.lookup.live,
    };
  }

  /**
   * Stage 2 — ask NIBSS to send the code to the method the holder picked.
   * Same one-per-minute throttle as the SMS OTP flow, enforced here (not
   * just in the UI) so a bypassed or scripted client can't spam Mono.
   */
  async sendBvnLookupOtp(userId: string, method: string, phoneNumber?: string) {
    if (!/^(phone(?:_\d+)?|sms)$/.test(method) || phoneNumber !== undefined) {
      throw new BadRequestException("Approval codes can only be sent to the phone number linked to your BVN.");
    }
    const consent = this.activeConsent(userId);
    if (consent.lastOtpSentAt && Date.now() - consent.lastOtpSentAt < BVN_OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (BVN_OTP_RESEND_COOLDOWN_MS - (Date.now() - consent.lastOtpSentAt)) / 1000,
      );
      throw new HttpException(
        `Please wait ${wait}s before requesting another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.lookup.sendBvnOtp(consent.sessionId, method, phoneNumber);
    consent.lastOtpSentAt = Date.now();
    return {
      sent: true as const,
      resendAvailableInSeconds: BVN_OTP_RESEND_COOLDOWN_MS / 1000,
      // The overall consent session doesn't reset on a resend — mirror it
      // back (same field name as the start response) so the UI's two
      // countdowns stay in sync with the server instead of drifting from
      // client-side guesses.
      expiresInSeconds: Math.max(0, Math.round((consent.expiresAt - Date.now()) / 1000)),
    };
  }

  /** Stage 3 — exchange the OTP for the record and store the comparison. */
  async completeBvnLookup(userId: string, otp: string) {
    const consent = this.activeConsent(userId);
    const record = await this.lookup.fetchBvn(consent.sessionId, otp);
    this.bvnConsents.delete(userId);
    // Run by the customer themselves — no staff member to attribute it to.
    return { check: await this.storeIdentityCheck(userId, record) };
  }

  /**
   * NIN needs no consent leg, and NIN *is* stored in plain text, so this one
   * is reviewer-initiated from the workspace with no applicant round-trip.
   */
  async lookupNin(staffId: string, userId: string) {
    const profile = await this.getProfileRow(userId);
    if (!profile.nin) {
      throw new BadRequestException("This applicant hasn't given a NIN yet");
    }
    const record = await this.lookup.lookupNin(profile.nin);
    await this.storeIdentityCheck(userId, record, staffId);
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "kyc.nin_lookup",
      targetType: "user",
      targetId: userId,
    });
    return this.getForStaff(staffId, userId);
  }

  /**
   * The no-consent identity check an admin can run any time, with the
   * applicant not present — e.g. their code-based check failed, they can't
   * get through it, or the reviewer just wants to (re)confirm before a
   * decision. Needs a decryptable BVN (see toProfileWrite/BVN_ENCRYPTION_KEY)
   * plus the NIN and date of birth already on file.
   */
  async verifyBvnNinMashup(staffId: string, userId: string) {
    const profile = await this.getProfileRow(userId);
    const bvn = decryptSecretOrNull(profile.bvnEncrypted);
    if (!bvn) {
      throw new BadRequestException(
        hasEncryptionKey()
          ? "No recoverable BVN on file for this applicant — it was saved before this check existed, or the applicant hasn't given one. Ask them to re-enter their BVN, or use the applicant's own approval-code check."
          : "BVN_ENCRYPTION_KEY isn't configured on this environment, so no BVN can be recovered for this check.",
      );
    }
    if (!profile.nin) throw new BadRequestException("This applicant hasn't given a NIN yet");
    if (!profile.dateOfBirth) throw new BadRequestException("This applicant hasn't given a date of birth yet");

    const record = await this.lookup.mashup(bvn, profile.nin, profile.dateOfBirth);
    await this.storeIdentityCheck(userId, record, staffId);
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "kyc.mashup_lookup",
      targetType: "user",
      targetId: userId,
    });
    return this.getForStaff(staffId, userId);
  }

  /**
   * Same check, run automatically the moment a profile is submitted — while
   * BVN, NIN and DOB are all freshly on file, before anyone waits on a
   * reviewer. Never blocks the submission: a down NIBSS, an unconfigured
   * key, or a genuine mismatch all just leave `identityLookup` unset, same
   * as if nobody had run a check yet, and a reviewer can retry by hand.
   */
  private async autoVerifyIdentityOnSubmit(userId: string): Promise<void> {
    const profile = await this.getProfileRow(userId);
    const bvn = decryptSecretOrNull(profile.bvnEncrypted);
    if (!bvn || !profile.nin || !profile.dateOfBirth) return;
    try {
      const record = await this.lookup.mashup(bvn, profile.nin, profile.dateOfBirth);
      await this.storeIdentityCheck(userId, record);
    } catch {
      // Swallow — a reviewer sees "not checked yet" and can retry from the
      // workspace; the applicant's submission must not fail because of this.
    }
  }

  /**
   * Stores the *comparison*, not the record. Everything Mono returned beyond
   * these few fields — the photo especially — is dropped: we asked whether
   * the applicant is who they say they are, and that answer is all a
   * reviewer needs (§13).
   */
  private async storeIdentityCheck(userId: string, record: IdentityRecord, staffId: string | null = null) {
    const profile = await this.getProfileRow(userId);
    const check = matchIdentity(
      record,
      {
        fullName: profile.fullName,
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        phone: profile.phone,
        nin: profile.nin,
      },
      { live: this.lookup.live },
    );
    // Two homes, written together: the history table keeps every check (so a
    // NIN check no longer erases the BVN one), and the profile column keeps the
    // latest for the screens that still read it.
    await this.db.transaction(async (tx) => {
      await recordIdentityVerification(tx, { userId, check, staffId });
      await tx
        .update(applicantProfiles)
        .set({ identityLookup: check, identityLookupAt: new Date(), updatedAt: new Date() })
        .where(eq(applicantProfiles.userId, userId));
    });
    return check;
  }

  private activeConsent(userId: string) {
    const consent = this.bvnConsents.get(userId);
    if (!consent || consent.expiresAt <= Date.now()) {
      this.bvnConsents.delete(userId);
      throw new BadRequestException(
        "That verification session has expired — start again to get a new code.",
      );
    }
    return consent;
  }

  async reviewDocument(staffId: string, userId: string, docId: string, input: ReviewDocumentInput) {
    if (input.status === "rejected" && !input.rejectionReason) {
      throw new BadRequestException("A reason is required when rejecting a document");
    }
    const [doc] = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.id, docId), eq(kycDocuments.userId, userId)))
      .limit(1);
    if (!doc) throw new NotFoundException("Document not found");
    const [row] = await this.db
      .update(kycDocuments)
      .set({
        status: input.status,
        rejectionReason: input.status === "rejected" ? input.rejectionReason : null,
        reviewedAt: new Date(),
        reviewedByStaffId: staffId,
      })
      .where(eq(kycDocuments.id, docId))
      .returning();
    return this.publicDoc(row);
  }

  /**
   * Verify the person, or send them back with a note. `verified` also creates
   * their `credit_profiles` row (limit 0) and marks it verified — the per-order
   * approval flow is what actually extends spendable credit.
   */
  async decideVerification(staffId: string, userId: string, input: VerifyKycInput) {
    const profile = await this.getProfileRow(userId);
    if (input.decision === "needs_more_info" && !input.note) {
      throw new BadRequestException("Add a note telling the applicant what to fix");
    }

    await this.db.transaction(async (tx) => {
      if (input.decision === "verified") {
        await tx
          .update(applicantProfiles)
          .set({
            verificationStatus: "verified",
            verifiedAt: new Date(),
            verifiedByStaffId: staffId,
            verificationNote: null,
            updatedAt: new Date(),
          })
          .where(eq(applicantProfiles.userId, userId));
        await tx
          .insert(creditProfiles)
          .values({ userId, isVerified: true })
          .onConflictDoUpdate({ target: creditProfiles.userId, set: { isVerified: true, updatedAt: new Date() } });
      } else {
        await tx
          .update(applicantProfiles)
          .set({ verificationStatus: "needs_more_info", verificationNote: input.note, updatedAt: new Date() })
          .where(eq(applicantProfiles.userId, userId));
      }
      await tx.insert(kycEvents).values({
        userId,
        actorStaffId: staffId,
        fromStatus: profile.verificationStatus,
        toStatus: input.decision === "verified" ? "verified" : "needs_more_info",
        note: input.note,
      });
      await tx.insert(auditLogs).values({
        actorStaffId: staffId,
        action: `kyc.${input.decision}`,
        targetType: "user",
        targetId: userId,
        metadata: input.note ? { note: input.note } : undefined,
      });
    });

    if (input.decision === "verified") {
      void this.email.send({ to: profile.email, ...emails.verified(profile.fullName) });
    } else {
      void this.email.send({
        to: profile.email,
        ...emails.verificationNeedsInfo(profile.fullName, input.note ?? ""),
      });
    }

    return { userId, verificationStatus: input.decision === "verified" ? "verified" : "needs_more_info" };
  }

  // ── shared ──────────────────────────────────────────────────────────────

  /** Used by OrdersService to gate checkout. */
  async assertVerified(userId: string) {
    const [p] = await this.db
      .select({ status: applicantProfiles.verificationStatus })
      .from(applicantProfiles)
      .where(eq(applicantProfiles.userId, userId))
      .limit(1);
    if (p?.status !== "verified") throw new ForbiddenException("NOT_VERIFIED");
  }

  async getVerificationStatus(userId: string): Promise<string> {
    const [p] = await this.db
      .select({ status: applicantProfiles.verificationStatus })
      .from(applicantProfiles)
      .where(eq(applicantProfiles.userId, userId))
      .limit(1);
    return p?.status ?? "unverified";
  }

  private async getProfileRow(userId: string) {
    const [row] = await this.db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId)).limit(1);
    if (!row) throw new NotFoundException("No KYC profile for this account");
    return row;
  }

  private async toProfileWrite(input: Partial<RegisterInput>): Promise<ProfileWrite> {
    const w: ProfileWrite = {};
    if (input.fullName !== undefined) w.fullName = input.fullName;
    if (input.email !== undefined) w.email = input.email;
    if (input.dateOfBirth !== undefined) w.dateOfBirth = input.dateOfBirth;
    if (input.gender !== undefined) w.gender = input.gender;
    if (input.maritalStatus !== undefined) w.maritalStatus = input.maritalStatus;
    if (input.dependantsCount !== undefined) w.dependantsCount = input.dependantsCount;
    if (input.bvn !== undefined) {
      w.bvnHash = await argon2.hash(input.bvn, { type: argon2.argon2id });
      w.bvnLast4 = input.bvn.slice(-4);
      // Additive: the hash above stays primary. Only set when a key exists,
      // so an unconfigured environment just leaves this column null instead
      // of throwing on every profile save.
      if (hasEncryptionKey()) w.bvnEncrypted = encryptSecret(input.bvn);
    }
    if (input.nin !== undefined) w.nin = input.nin;
    if (input.residentialAddress !== undefined) w.residentialAddress = input.residentialAddress;
    if (input.stateOfOrigin !== undefined) w.stateOfOrigin = input.stateOfOrigin;
    if (input.lgaOfOrigin !== undefined) {
      // Canonicalise against the state in the same request when we have it.
      // A partial PATCH carrying only the LGA can't be checked here — the
      // merged pair is validated in submitForVerification instead, so a
      // mismatch can't be submitted even if it can be saved mid-edit.
      const canonical = canonicalLga(input.stateOfOrigin ?? null, input.lgaOfOrigin);
      w.lgaOfOrigin = canonical ?? input.lgaOfOrigin;
    }
    if (input.nextOfKin !== undefined) w.nextOfKin = input.nextOfKin;
    if (input.employmentType !== undefined) w.employmentType = input.employmentType;
    if (input.employer !== undefined) w.employer = input.employer;
    if (input.jobTitle !== undefined) w.jobTitle = input.jobTitle;
    if (input.netMonthlySalaryNaira !== undefined) w.netMonthlySalaryKobo = nairaToKobo(input.netMonthlySalaryNaira);
    if (input.salaryDay !== undefined) w.salaryDay = input.salaryDay;
    if (input.yearsEmployed !== undefined) w.yearsEmployed = input.yearsEmployed;
    if (input.bankName !== undefined) w.bankName = input.bankName;
    if (input.accountNumber !== undefined) w.accountLast4 = input.accountNumber.slice(-4);
    if (input.requestedLimitNaira !== undefined) w.requestedLimitKobo = nairaToKobo(input.requestedLimitNaira);
    return w;
  }

  private missingRequirements(p: typeof applicantProfiles.$inferSelect): string[] {
    const labels: Record<string, string> = {
      fullName: "your full name",
      dateOfBirth: "your date of birth",
      bvnHash: "your BVN",
      nin: "your NIN",
      residentialAddress: "your residential address",
      stateOfOrigin: "your state of origin",
      lgaOfOrigin: "your LGA of origin",
      employmentType: "your employment status",
      employer: "your employer",
      jobTitle: "your job title",
      netMonthlySalaryKobo: "your monthly income",
    };
    // An empty string is "not filled in" just as much as null — older rows
    // predate the `.min(1)` on these fields, and `== null` would wave them
    // through with a blank employer on the file.
    const blank = (v: unknown) =>
      v == null || (typeof v === "string" && v.trim() === "");
    return REQUIRED_PROFILE_FIELDS.filter((f) => blank(p[f])).map((f) => labels[f] ?? f);
  }

  private publicProfile(p: typeof applicantProfiles.$inferSelect) {
    // bvnEncrypted never leaves the server, even to an admin — it decrypts
    // to a real BVN, so it gets the same treatment as bvnHash. Reviewers
    // get bvnMashupAvailable, a yes/no on whether the no-consent check can
    // run, not the value that check runs on.
    const { bvnHash, bvnLast4, bvnEncrypted, verifiedByStaffId, ...rest } = p;
    return { ...rest, hasBvn: !!bvnHash, bvnMashupAvailable: decryptSecretOrNull(bvnEncrypted) !== null };
  }

  private publicDoc(d: typeof kycDocuments.$inferSelect) {
    return {
      id: d.id,
      kind: d.kind,
      status: d.status,
      rejectionReason: d.rejectionReason,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      reviewedAt: d.reviewedAt,
    };
  }
}
