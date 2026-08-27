import { SetMetadata } from "@nestjs/common";

export type StaffRole = "super_admin" | "admin" | "credit" | "sales";

export const ROLES_KEY = "roles";

/**
 * Every route carries an explicit policy decorator; a route without one
 * fails a CI lint rule (§13 — "deny by default"). That lint rule doesn't
 * exist yet in this scaffold — add it alongside the first real module.
 */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);
