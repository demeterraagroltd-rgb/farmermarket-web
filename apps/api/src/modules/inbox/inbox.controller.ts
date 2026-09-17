import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CronSecretGuard } from "../../common/guards/cron-secret.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { InboxService } from "./inbox.service";
import { ReplyDto, replySchema } from "./dto/inbox.dto";

// Staff-facing: read and answer mail sent to admin@farmermarket.ng.
@ApiTags("inbox")
@ApiBearerAuth()
@Controller("admin/inbox")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get("threads")
  listThreads() {
    return this.inbox.listThreads();
  }

  @Get("threads/:id")
  getThread(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.inbox.getThread(id);
  }

  @Post("threads/:id/reply")
  reply(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(replySchema)) body: ReplyDto,
  ) {
    return this.inbox.reply(id, staff.staffId, body);
  }
}

// Machine-triggered: a GitHub Actions schedule POSTs here with the shared
// `x-cron-secret` header to pull new mail into the dashboard every few
// minutes — same pattern and secret as the daily collections run.
@ApiTags("inbox")
@Controller("inbox")
export class InboxCronController {
  constructor(private readonly inbox: InboxService) {}

  @Post("sync")
  @UseGuards(CronSecretGuard)
  sync() {
    return this.inbox.sync();
  }
}
