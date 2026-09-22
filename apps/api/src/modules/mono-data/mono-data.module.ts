import { Module } from "@nestjs/common";
import { MonoSyncService } from "./mono-sync.service";
import { ScheduledSyncService } from "./scheduled-sync.service";
import { MonoCronController } from "./mono-cron.controller";

// Persistent Mono data. MONO_CLIENT comes from the global MonoModule and DB from
// the global DbModule, so this needs no imports of its own.
@Module({
  controllers: [MonoCronController],
  providers: [MonoSyncService, ScheduledSyncService],
  exports: [MonoSyncService],
})
export class MonoDataModule {}
