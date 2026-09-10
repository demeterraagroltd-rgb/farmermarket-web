import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CronSecretGuard } from "../../common/guards/cron-secret.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CollectionsService } from "./collections.service";

const runSchema = z.object({
  // Preview what would go out without sending anything.
  dryRun: z.boolean().optional().default(false),
});

// Staff-triggered: a credit officer runs it, or previews it, from the
// dashboard's Repayments view.
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

// Machine-triggered: a once-daily scheduler (GitHub Actions workflow) POSTs
// here with the `x-cron-secret` header. Always a real run, never a preview.
@ApiTags("collections")
@Controller("collections")
export class CollectionsCronController {
  constructor(private readonly collections: CollectionsService) {}

  @Post("cron")
  @UseGuards(CronSecretGuard)
  cron() {
    return this.collections.run({ dryRun: false });
  }
}
