import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

export const payRepaymentSchema = z.object({
  amountNaira: z.number().positive(),
});

export type PayRepaymentInput = z.infer<typeof payRepaymentSchema>;

export class PayRepaymentDto implements PayRepaymentInput {
  @ApiProperty()
  amountNaira!: number;
}
