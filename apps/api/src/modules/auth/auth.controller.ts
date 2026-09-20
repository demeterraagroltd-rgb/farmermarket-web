import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { LoginDto, loginSchema } from "./dto/login.dto";
import { CustomerLoginDto, customerLoginSchema } from "./dto/customer-login.dto";
import {
  ChangePasswordDto,
  changePasswordSchema,
  ResetPasswordDto,
  resetPasswordSchema,
} from "./dto/customer-password.dto";
import { SetTxnPinDto, setTxnPinSchema } from "./dto/set-txn-pin.dto";
import { OtpRequestDto, otpRequestSchema, OtpVerifyDto, otpVerifySchema } from "./dto/otp.dto";

@ApiTags("auth")
@Controller("auth/staff")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginDto) {
    return this.authService.loginStaff(body);
  }
}

// Separate controller/route namespace from staff auth — same service,
// different identity model (phone + password) and a different guard
// downstream (CustomerJwtAuthGuard, not JwtAuthGuard).
@ApiTags("auth")
@Controller("auth/customer")
export class CustomerAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  @Post("login")
  async login(@Body(new ZodValidationPipe(customerLoginSchema)) body: CustomerLoginDto) {
    return this.authService.loginCustomer(body);
  }

  // ── Phone verification (Sign Up and password reset) ────────────────────
  // Public. `request` texts a 6-digit code; `verify` swaps a correct code
  // for a short-lived token that POST /auth/customer/register (purpose
  // "register") or POST /auth/customer/password/reset (purpose "reset")
  // requires.

  @Post("otp/request")
  requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequestDto) {
    return this.otpService.request(body.phone, body.purpose);
  }

  @Post("otp/verify")
  verifyOtp(@Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyDto) {
    return this.otpService.verify(body.phone, body.code, body.purpose);
  }

  // Public recovery: prove the phone by SMS, then choose a password. Also
  // the way accounts created before passwords existed get their first one.
  @Post("password/reset")
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto) {
    return this.authService.resetPassword(body.phone, body.phoneVerificationToken, body.password);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getCustomerMe(user.userId);
  }

  // Signed-in change — the current password must verify first.
  @Post("password/change")
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, body.currentPassword, body.newPassword);
  }

  // Called once, from the app's first-transaction flow.
  @Post("txn-pin")
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  setTxnPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setTxnPinSchema)) body: SetTxnPinDto,
  ) {
    return this.authService.setTxnPin(user.userId, body.pin);
  }
}
