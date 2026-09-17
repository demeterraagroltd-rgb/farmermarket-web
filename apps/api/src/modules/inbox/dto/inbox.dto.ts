import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

export const replySchema = z.object({
  text: z.string().min(1, "Reply can't be empty"),
});
export type ReplyInput = z.infer<typeof replySchema>;

export class ReplyDto {
  @ApiProperty() text!: string;
}
