import { Body, Controller, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { LoginDto, loginSchema } from "./dto/login.dto";

@ApiTags("auth")
@Controller("auth/staff")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginDto) {
    return this.authService.loginStaff(body);
  }
}
