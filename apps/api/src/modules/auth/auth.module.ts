import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SmsModule } from "../integrations/sms/sms.module";
import { AuthController, CustomerAuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";

@Module({
  imports: [
    SmsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-only-secret-do-not-use-in-prod",
    }),
  ],
  controllers: [AuthController, CustomerAuthController],
  providers: [AuthService, OtpService],
  exports: [JwtModule, AuthService, OtpService],
})
export class AuthModule {}
