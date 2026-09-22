import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { CronSecretGuard } from "../../common/guards/cron-secret.guard";
import { ScheduledSyncService } from "./scheduled-sync.service";

// Machine-triggered, same shape as CollectionsCronController: an external
// scheduler (GitHub Actions) POSTs here with the shared `x-cron-secret`
// header. Never touches staff auth — see CronSecretGuard.
@ApiExcludeController()
@Controller("mono")
export class MonoCronController {
  constructor(private readonly scheduledSync: ScheduledSyncService) {}

  @Post("sync-cron")
  @UseGuards(CronSecretGuard)
  cron() {
    return this.scheduledSync.runDueSyncs();
  }
}
