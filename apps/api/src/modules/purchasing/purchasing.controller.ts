import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PurchasingService } from "./purchasing.service";
import { purchaseSchema, updatePurchaseSchema, receiptSchema, supplierSchema, transitionSchema, type PurchaseInput, type ReceiptInput, type SupplierInput, type TransitionInput } from "./purchasing.dto";
@Controller("admin/purchasing")
@ApiTags("purchasing") @ApiBearerAuth() @UseGuards(JwtAuthGuard,RolesGuard) @Roles("admin","super_admin")
export class PurchasingController {
 constructor(private readonly service:PurchasingService) {}
 @Get("context") context(@CurrentStaff() actor:AuthenticatedStaff){return actor;}
 @Get("suppliers") suppliers(){return this.service.suppliers();}
 @Post("suppliers") createSupplier(@Body(new ZodValidationPipe(supplierSchema)) body:SupplierInput,@CurrentStaff() actor:AuthenticatedStaff){return this.service.saveSupplier(body,actor);}
 @Patch("suppliers/:id") updateSupplier(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(supplierSchema)) body:SupplierInput,@CurrentStaff() actor:AuthenticatedStaff){return this.service.saveSupplier(body,actor,id);}
 @Get("orders") list(){return this.service.list();}
 @Get("receipts/:id") receipt(@Param("id",ParseUUIDPipe) id:string){return this.service.receiptOrder(id);}
 @Post("orders") create(@Body(new ZodValidationPipe(purchaseSchema)) body:PurchaseInput,@CurrentStaff() actor:AuthenticatedStaff){return this.service.create(body,actor);}
 @Get("orders/:id") detail(@Param("id",ParseUUIDPipe) id:string){return this.service.detail(id);}
 @Patch("orders/:id") edit(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(updatePurchaseSchema)) body:PurchaseInput & {version:number},@CurrentStaff() actor:AuthenticatedStaff){return this.service.updateDraft(id,body,actor);}
 @Post("orders/:id/actions") transition(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(transitionSchema)) body:TransitionInput,@CurrentStaff() actor:AuthenticatedStaff){return this.service.transition(id,body,actor);}
 @Post("orders/:id/receipts") receive(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(receiptSchema)) body:ReceiptInput,@CurrentStaff() actor:AuthenticatedStaff){return this.service.receive(id,body,actor);}
}
