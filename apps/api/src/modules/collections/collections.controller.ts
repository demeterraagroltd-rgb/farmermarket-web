import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CollectionsService } from "./collections.service";

const runSchema = z.object({
  // Preview what would go out without sending anything.
  dryRun: z.boolean().optional().default(false),
});

// Staff-triggered for now — a credit officer runs it, or previews it, from
// the dashboard's Repayments view. The intent is a once-daily cron calling
// this; that needs a service-auth mechanism (shared secret / token) which
// isn't built, so it's admin-JWT only today.
@ApiTags("collections")
@ApiBearerAuth()
@Controller("admin/collections")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post("run")
  @Roles("super_admin", "admin")
  run(@Body(new ZodValidationPipe(runSchema)) body: { dryRun: boolean }) {
    return this.collections.run({ dryRun: body.dryRun });
  }
}
