import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { LoginDto, loginSchema } from "./dto/login.dto";
import { CustomerLoginDto, customerLoginSchema } from "./dto/customer-login.dto";

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
// different identity model (phone, no password) and different guard
// downstream (CustomerJwtAuthGuard, not JwtAuthGuard).
@ApiTags("auth")
@Controller("auth/customer")
export class CustomerAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body(new ZodValidationPipe(customerLoginSchema)) body: CustomerLoginDto) {
    return this.authService.loginCustomer(body);
  }
}
