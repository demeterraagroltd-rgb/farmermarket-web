import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { KycService } from "./kyc.service";
import {
  ReviewDocumentDto,
  reviewDocumentSchema,
  VerifyKycDto,
  verifyKycSchema,
} from "./dto/kyc.dto";

// The verification queue + review workspace (§11.4). "Verify" clears the
// person; "needs_more_info" bounces them back with a note. Iterative — a
// reviewer can act on the same profile as many times as it takes.
@ApiTags("kyc")
@ApiBearerAuth()
@Controller("admin/kyc")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  queue() {
    return this.kyc.listQueue();
  }

  @Get(":userId")
  detail(@CurrentStaff() staff: AuthenticatedStaff, @Param("userId") userId: string) {
    return this.kyc.getForStaff(staff.staffId, userId);
  }

  @Patch(":userId/documents/:docId")
  reviewDocument(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("userId") userId: string,
    @Param("docId") docId: string,
    @Body(new ZodValidationPipe(reviewDocumentSchema)) body: ReviewDocumentDto,
  ) {
    return this.kyc.reviewDocument(staff.staffId, userId, docId, body);
  }

  @Patch(":userId/verification")
  decide(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(verifyKycSchema)) body: VerifyKycDto,
  ) {
    return this.kyc.decideVerification(staff.staffId, userId, body);
  }
}
