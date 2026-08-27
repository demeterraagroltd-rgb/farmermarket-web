import { Injectable, type CanActivate, type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, type StaffRole } from "../decorators/roles.decorator";

/**
 * Runs after JwtAuthGuard has attached `request.staff`. Deny by default —
 * a route with no @Roles() decorator has nothing to check here, so pair
 * this with the CI lint rule mentioned in roles.decorator.ts once it exists.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const role: StaffRole | undefined = request.staff?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(`Requires one of: ${required.join(", ")}`);
    }
    return true;
  }
}
