import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuthService } from "./auth.service";
import { LoginDto, loginSchema } from "./dto/login.dto";
import { CustomerLoginDto, customerLoginSchema } from "./dto/customer-login.dto";
import { SetTxnPinDto, setTxnPinSchema } from "./dto/set-txn-pin.dto";

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
// different identity model (phone + 6-digit login code, no password) and a
// different guard downstream (CustomerJwtAuthGuard, not JwtAuthGuard).
@ApiTags("auth")
@Controller("auth/customer")
export class CustomerAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body(new ZodValidationPipe(customerLoginSchema)) body: CustomerLoginDto) {
    return this.authService.loginCustomer(body);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getCustomerMe(user.userId);
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
