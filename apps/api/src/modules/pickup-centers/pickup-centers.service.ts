import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { orders, pickupCenters, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { CreatePickupCenterInput, UpdatePickupCenterInput } from "./dto/pickup-center.dto";

@Injectable()
export class PickupCentersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Everything, active or not — the admin list. */
  listAll() {
    return this.db.select().from(pickupCenters).orderBy(pickupCenters.name);
  }

  /** What checkout offers. */
  listActive() {
    return this.db
      .select()
      .from(pickupCenters)
      .where(eq(pickupCenters.isActive, true))
      .orderBy(pickupCenters.name);
  }

  create(input: CreatePickupCenterInput) {
    return this.db
      .insert(pickupCenters)
      .values(input)
      .returning()
      .then((rows) => rows[0]);
  }

  async update(id: string, input: UpdatePickupCenterInput) {
    const [updated] = await this.db
      .update(pickupCenters)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(pickupCenters.id, id))
      .returning();
    if (!updated) throw new NotFoundException("Pickup centre not found");
    return updated;
  }

  /**
   * Only a centre no order has ever referenced can be deleted; anything else
   * gets deactivated, so the foreign key on a past order keeps resolving.
   */
  async remove(id: string) {
    const [centre] = await this.db
      .select({ id: pickupCenters.id })
      .from(pickupCenters)
      .where(eq(pickupCenters.id, id))
      .limit(1);
    if (!centre) throw new NotFoundException("Pickup centre not found");

    const [referencing] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.pickupCenterId, id))
      .limit(1);
    if (referencing) {
      throw new BadRequestException(
        "Orders have already been placed against this centre — deactivate it instead of deleting it.",
      );
    }

    await this.db.delete(pickupCenters).where(eq(pickupCenters.id, id));
    return { deleted: true as const };
  }
}
