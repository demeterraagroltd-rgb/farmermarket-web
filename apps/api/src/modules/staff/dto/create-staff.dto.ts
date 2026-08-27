import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

export const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(["super_admin", "admin", "credit", "sales"]),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export class CreateStaffDto implements CreateStaffInput {
  @ApiProperty()
  email!: string;

  @ApiProperty()
  password!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: ["super_admin", "admin", "credit", "sales"] })
  role!: "super_admin" | "admin" | "credit" | "sales";
}
