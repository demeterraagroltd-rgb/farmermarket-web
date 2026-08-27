import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { nairaToKobo } from "@farmermarket/core";
import { applications, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { CreateApplicationInput } from "./dto/create-application.dto";

function generateReference(): string {
  const year = new Date().getFullYear();
  const digits = Math.floor(10000 + Math.random() * 90000);
  return `FM-${year}-${digits}`;
}

@Injectable()
export class ApplicationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(input: CreateApplicationInput) {
    const [row] = await this.db
      .insert(applications)
      .values({
        reference: generateReference(),
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
  }

  async findAll() {
    return this.db.select().from(applications).orderBy(desc(applications.createdAt));
  }

  async findOne(id: string) {
    const [row] = await this.db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!row) throw new NotFoundException("Application not found");
    return row;
  }
}
