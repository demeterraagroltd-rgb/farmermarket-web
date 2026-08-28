import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

export const payRepaymentSchema = z.object({
  amountNaira: z.number().positive(),
  // 4-digit transaction code — required to authorize the payment.
  txnPin: z.string().regex(/^\d{4}$/, "Transaction code must be 4 digits"),
});

export type PayRepaymentInput = z.infer<typeof payRepaymentSchema>;

export class PayRepaymentDto implements PayRepaymentInput {
  @ApiProperty()
  amountNaira!: number;

  @ApiProperty({ description: "4-digit transaction code" })
  txnPin!: string;
}
