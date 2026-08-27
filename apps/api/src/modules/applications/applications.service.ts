import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { nairaToKobo } from "@farmermarket/core";
import {
  applications,
  applicationDecisions,
  applicationEvents,
  creditProfiles,
  creditLimitChanges,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { CreateApplicationInput } from "./dto/create-application.dto";
import type { DecideApplicationInput } from "./dto/decide-application.dto";

function generateReference(): string {
  const year = new Date().getFullYear();
  const digits = Math.floor(10000 + Math.random() * 90000);
  return `FM-${year}-${digits}`;
}

const DECIDED_STATUSES = new Set(["approved", "declined"]);

const OUTCOME_TO_STATUS = {
  approved: "approved",
  declined: "declined",
  referred: "escalated",
} as const;

@Injectable()
export class ApplicationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(input: CreateApplicationInput) {
    return this.db.transaction(async (tx) => {
      // No phone-OTP signup yet (Termii isn't wired up), so this is the
      // stand-in identity step: reuse a customer record by phone, or create
      // one. Swap for real OTP-verified signup once Termii lands (§14).
      const [existingUser] = await tx.select().from(users).where(eq(users.phone, input.phone)).limit(1);
      const user =
        existingUser ??
        (
          await tx
            .insert(users)
            .values({ phone: input.phone, fullName: input.fullName, email: input.email })
            .returning()
        )[0];

      const [row] = await tx
        .insert(applications)
        .values({
          reference: generateReference(),
          userId: user.id,
          channel: "web",
          status: "submitted",
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          employer: input.employer,
          employmentType: input.employmentType,
          jobTitle: input.jobTitle,
          netMonthlySalaryKobo:
            input.netMonthlySalaryNaira !== undefined
              ? nairaToKobo(input.netMonthlySalaryNaira)
              : undefined,
          requestedLimitKobo: nairaToKobo(input.requestedLimitNaira),
          salaryDay: input.salaryDay,
          submittedAt: new Date(),
        })
        .returning();

      return row;
    });
  }

  async findAll() {
    return this.db.select().from(applications).orderBy(desc(applications.createdAt));
  }

  async findOne(id: string) {
    const [row] = await this.db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!row) throw new NotFoundException("Application not found");
    return row;
  }

  // Powers the review workspace's Activity timeline. Every status
  // transition writes an `application_events` row (see decide() below);
  // this just reads them back oldest-first, with the actor's name resolved
  // so the timeline doesn't just show a bare staff id.
  async getEvents(id: string) {
    return this.db
      .select({
        id: applicationEvents.id,
        fromStatus: applicationEvents.fromStatus,
        toStatus: applicationEvents.toStatus,
        reason: applicationEvents.reason,
        createdAt: applicationEvents.createdAt,
        actorName: staff.fullName,
      })
      .from(applicationEvents)
      .leftJoin(staff, eq(staff.id, applicationEvents.actorStaffId))
      .where(eq(applicationEvents.applicationId, id))
      .orderBy(asc(applicationEvents.createdAt));
  }

  // Manual verification checklist (no Mono/FirstCentral automating this
  // yet) — a real underwriting gate, not a UI-only toggle. decide() below
  // refuses to approve until all three are true.
  async setVerification(
    id: string,
    updates: Partial<{ identityVerified: boolean; employerVerified: boolean; documentsVerified: boolean }>,
  ) {
    const [row] = await this.db
      .update(applications)
      .set(updates)
      .where(eq(applications.id, id))
      .returning();
    if (!row) throw new NotFoundException("Application not found");
    return row;
  }

  // Product loop steps 2-3 (§2): a decision, and — if approved — the write
  // that actually unlocks spending. Both happen in one transaction so a
  // credit_profiles update never exists without its audit trail, or vice versa.
  async decide(applicationId: string, decidedBy: string, input: DecideApplicationInput) {
    return this.db.transaction(async (tx) => {
      const [application] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId))
        .limit(1);
      if (!application) throw new NotFoundException("Application not found");
      if (DECIDED_STATUSES.has(application.status)) {
        throw new BadRequestException(`Application is already ${application.status}`);
      }
      if (
        input.outcome === "approved" &&
        !(application.identityVerified && application.employerVerified && application.documentsVerified)
      ) {
        throw new BadRequestException(
          "Complete identity, employment, and document verification before approving",
        );
      }

      const approvedLimitKobo =
        input.outcome === "approved" && input.approvedLimitNaira !== undefined
          ? nairaToKobo(input.approvedLimitNaira)
          : undefined;

      const [decision] = await tx
        .insert(applicationDecisions)
        .values({
          applicationId,
          outcome: input.outcome,
          approvedLimitKobo,
          reasonCodes: input.reasonCodes ?? [],
          notes: input.notes,
          decidedBy,
        })
        .returning();

      const toStatus = OUTCOME_TO_STATUS[input.outcome];
      await tx
        .update(applications)
        .set({ status: toStatus, updatedAt: new Date() })
        .where(eq(applications.id, applicationId));

      await tx.insert(applicationEvents).values({
        applicationId,
        actorStaffId: decidedBy,
        fromStatus: application.status,
        toStatus,
        reason: input.notes,
      });

      if (input.outcome === "approved" && approvedLimitKobo !== undefined && application.userId) {
        const [existingProfile] = await tx
          .select()
          .from(creditProfiles)
          .where(eq(creditProfiles.userId, application.userId))
          .limit(1);
        const beforeKobo = existingProfile?.creditLimitKobo ?? 0n;

        if (existingProfile) {
          await tx
            .update(creditProfiles)
            .set({ creditLimitKobo: approvedLimitKobo, isVerified: true, updatedAt: new Date() })
            .where(eq(creditProfiles.userId, application.userId));
        } else {
          await tx.insert(creditProfiles).values({
            userId: application.userId,
            creditLimitKobo: approvedLimitKobo,
            isVerified: true,
          });
        }

        await tx.insert(creditLimitChanges).values({
          userId: application.userId,
          beforeKobo,
          afterKobo: approvedLimitKobo,
          reason: `Application ${application.reference} approved`,
          actorStaffId: decidedBy,
        });

        await tx
          .update(applications)
          .set({ status: "limit_active" })
          .where(eq(applications.id, applicationId));
      }

      return decision;
    });
  }
}
