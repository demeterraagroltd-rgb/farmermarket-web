import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { StaffRole } from "./roles.decorator";

export interface AuthenticatedStaff {
  staffId: string;
  role: StaffRole;
}

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const request = ctx.switchToHttp().getRequest();
    return request.staff;
  },
);
