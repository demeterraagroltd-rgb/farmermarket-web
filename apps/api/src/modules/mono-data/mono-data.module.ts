import { Module } from "@nestjs/common";
import { MonoSyncService } from "./mono-sync.service";

// Persistent Mono data. MONO_CLIENT comes from the global MonoModule and DB from
// the global DbModule, so this needs no imports of its own.
@Module({
  providers: [MonoSyncService],
  exports: [MonoSyncService],
})
export class MonoDataModule {}
