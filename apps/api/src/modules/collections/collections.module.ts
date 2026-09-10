import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CollectionsController, CollectionsCronController } from "./collections.controller";
import { CollectionsService } from "./collections.service";

@Module({
  imports: [AuthModule], // JwtService for JwtAuthGuard
  controllers: [CollectionsController, CollectionsCronController],
  providers: [CollectionsService],
  exports: [CollectionsService], // the worker will call this directly later
})
export class CollectionsModule {}
