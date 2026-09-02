import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { KycService } from "./kyc.service";
import {
  RegisterDto,
  registerSchema,
  UpdateKycDto,
  updateKycSchema,
  UploadDocumentDto,
  uploadDocumentSchema,
} from "./dto/kyc.dto";

// Public — the mobile Sign Up wizard and the web /apply wizard both post here.
@ApiTags("auth")
@Controller("auth/customer")
export class CustomerRegisterController {
  constructor(private readonly kyc: KycService) {}

  @Post("register")
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterDto) {
    return this.kyc.register(body as never);
  }
}

@ApiTags("kyc")
@ApiBearerAuth()
@Controller("kyc")
@UseGuards(CustomerJwtAuthGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.getMyKyc(user.userId);
  }

  @Patch("me")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateKycSchema)) body: UpdateKycDto,
  ) {
    return this.kyc.updateKyc(user.userId, body as never);
  }

  @Post("submit")
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.submitForVerification(user.userId);
  }

  @Post("documents")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(uploadDocumentSchema)) body: UploadDocumentDto,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    return this.kyc.uploadDocument(user.userId, body.kind, file);
  }

  @Delete("documents/:id")
  deleteDocument(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.kyc.deleteDocument(user.userId, id);
  }
}
