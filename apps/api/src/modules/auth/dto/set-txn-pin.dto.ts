import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// The 4-digit transaction code the user creates on their first transaction.
export const setTxnPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Transaction code must be 4 digits"),
});

export type SetTxnPinInput = z.infer<typeof setTxnPinSchema>;

export class SetTxnPinDto implements SetTxnPinInput {
  @ApiProperty({ description: "4-digit transaction code" })
  pin!: string;
}
