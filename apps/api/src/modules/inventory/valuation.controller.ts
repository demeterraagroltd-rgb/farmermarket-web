import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,UseGuards } from "@nestjs/common";
import { ApiBearerAuth,ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff,type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ValuationService } from "./valuation.service";
export const costSchema=z.object({unitCostNaira:z.number().min(0).max(100000000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001,"Use at most two decimal places"),version:z.number().int().positive(),reason:z.string().trim().min(3).max(1000),operationId:z.string().uuid()});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,"Enter a valid date");
const period=z.object({from:date,to:date}).refine(p=>p.from<=p.to,"End date must follow start date");
@Controller("admin/inventory/valuation") @ApiTags("inventory-valuation") @ApiBearerAuth()
@UseGuards(JwtAuthGuard,RolesGuard) @Roles("admin","super_admin")
export class ValuationController {
 constructor(private readonly service:ValuationService){}
 @Get() overview(){return this.service.overview();}
 @Get("cogs") report(@Query(new ZodValidationPipe(period)) query:{from:string;to:string}){return this.service.report(query.from,query.to);}
 @Post("lots/:id/cost") assign(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(costSchema)) input:z.infer<typeof costSchema>,@CurrentStaff() actor:AuthenticatedStaff){return this.service.assign(id,input,actor);}
}
