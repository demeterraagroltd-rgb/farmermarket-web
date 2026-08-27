import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApplicationsService } from "./applications.service";
import { CreateApplicationDto, createApplicationSchema } from "./dto/create-application.dto";

// Public — no auth. This is step 1 of the plan's product loop (§2):
// "Apply | Web, public | applications row, status submitted".
@ApiTags("applications")
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createApplicationSchema)) body: CreateApplicationDto) {
    return this.applicationsService.create(body);
  }
}
