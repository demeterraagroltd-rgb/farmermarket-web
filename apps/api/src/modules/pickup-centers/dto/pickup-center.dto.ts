import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

// A pickup centre is where a buyer collects an order — Farmer Market doesn't
// run home delivery. Admin-managed (see AdminPickupCentersController); the
// public list feeds the checkout dropdown.
export const createPickupCenterSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().min(1).max(300),
});

export const updatePickupCenterSchema = createPickupCenterSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type CreatePickupCenterInput = z.infer<typeof createPickupCenterSchema>;
export type UpdatePickupCenterInput = z.infer<typeof updatePickupCenterSchema>;

export class CreatePickupCenterDto implements CreatePickupCenterInput {
  @ApiProperty({ example: "FCDA Secretariat" })
  name!: string;

  @ApiProperty({ example: "Plot 1, Secretariat Road, Wuse, Abuja" })
  address!: string;
}

export class UpdatePickupCenterDto implements UpdatePickupCenterInput {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional({ description: "False hides it from checkout without breaking past orders" })
  isActive?: boolean;
}
