import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import * as argon2 from "argon2";
import { nairaToKobo } from "@farmermarket/core";
import {
  applicantProfiles,
  auditLogs,
  creditProfiles,
  kycDocuments,
  kycEvents,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { JwtService } from "@nestjs/jwt";
import {
  destroyAsset,
  signedDownloadUrl,
  uploadPrivateBuffer,
} from "../../common/cloudinary";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import type { RegisterInput, UpdateKycInput, ReviewDocumentInput, VerifyKycInput } from "./dto/kyc.dto";

const CUSTOMER_ACCESS_TOKEN_TTL = "30d";

// A profile is ready to submit for verification once these are present.
// NIN and employment docs are deliberately deferrable (§ user's brief).
const REQUIRED_PROFILE_FIELDS: (keyof typeof applicantProfiles.$inferSelect)[] = [
  "fullName",
  "dateOfBirth",
  "bvnHash",
  "residentialAddress",
  "stateOfOrigin",
  "lgaOfOrigin",
];
const ID_DOC_KINDS = ["id_card", "passport", "drivers_license"] as const;

type ProfileWrite = Partial<typeof applicantProfiles.$inferInsert>;

@Injectable()
export class KycService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  // ── Registration ────────────────────────────────────────────────────────

  async register(input: RegisterInput) {
    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.phone, input.phone)).limit(1);
      if (existing?.loginCodeHash) {
        throw new BadRequestException("An account with this phone number already exists — please log in");
      }

      const loginCodeHash = await argon2.hash(input.loginCode, { type: argon2.argon2id });
      let user = existing;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ phone: input.phone, fullName: input.fullName, email: input.email, loginCodeHash })
          .returning();
      } else {
        [user] = await tx
          .update(users)
          .set({ fullName: input.fullName, email: input.email, loginCodeHash, updatedAt: new Date() })
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
    return this.getMyKyc(userId);
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

  async getForStaff(staffId: string, userId: string) {
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

    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "kyc.view",
      targetType: "user",
      targetId: userId,
    });

    return {
      profile: { ...this.publicProfile(profile), bvnLast4: profile.bvnLast4 },
      documents: docs.map((d) => ({
        ...this.publicDoc(d),
        url: signedDownloadUrl(d.cloudinaryPublicId, d.cloudinaryResourceType),
      })),
      events,
    };
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
    }
    if (input.nin !== undefined) w.nin = input.nin;
    if (input.residentialAddress !== undefined) w.residentialAddress = input.residentialAddress;
    if (input.stateOfOrigin !== undefined) w.stateOfOrigin = input.stateOfOrigin;
    if (input.lgaOfOrigin !== undefined) w.lgaOfOrigin = input.lgaOfOrigin;
    if (input.nextOfKin !== undefined) w.nextOfKin = input.nextOfKin;
    if (input.employmentType !== undefined) w.employmentType = input.employmentType;
    if (input.employer !== undefined) w.employer = input.employer;
    if (input.jobTitle !== undefined) w.jobTitle = input.jobTitle;
    if (input.netMonthlySalaryNaira !== undefined) w.netMonthlySalaryKobo = nairaToKobo(input.netMonthlySalaryNaira);
    if (input.salaryDay !== undefined) w.salaryDay = input.salaryDay;
    if (input.yearsEmployed !== undefined) w.yearsEmployed = input.yearsEmployed;
    if (input.bankName !== undefined) w.bankName = input.bankName;
    if (input.accountNumber !== undefined) w.accountLast4 = input.accountNumber.slice(-4);
    return w;
  }

  private missingRequirements(p: typeof applicantProfiles.$inferSelect): string[] {
    const labels: Record<string, string> = {
      fullName: "your full name",
      dateOfBirth: "your date of birth",
      bvnHash: "your BVN",
      residentialAddress: "your residential address",
      stateOfOrigin: "your state of origin",
      lgaOfOrigin: "your LGA of origin",
    };
    return REQUIRED_PROFILE_FIELDS.filter((f) => p[f] == null).map((f) => labels[f] ?? f);
  }

  private publicProfile(p: typeof applicantProfiles.$inferSelect) {
    const { bvnHash, bvnLast4, verifiedByStaffId, ...rest } = p;
    return { ...rest, hasBvn: !!bvnHash };
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
