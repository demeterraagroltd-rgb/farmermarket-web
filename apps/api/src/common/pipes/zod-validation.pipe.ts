import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

// One definition of "valid input", enforced server-side too, mirroring the
// same Zod schemas the web forms use (§3, "Forms" row).
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
