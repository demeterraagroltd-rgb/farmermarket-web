import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController, CustomerAuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-only-secret-do-not-use-in-prod",
    }),
  ],
  controllers: [AuthController, CustomerAuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
