import { and, asc, eq, isNull } from "drizzle-orm";
import type { LinkedApp } from "@yourtal/contracts/me/linked-app";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { partnerLinks } from "../../partners/persistence/schema/partner.table";

/**
 * 14.3.c: the caller's own partner links (`platform.partner_link`, written by
 * the partners module). Read the way `partners` reads `me.link_code`.
 */
export interface LinkedAppRepository {
  listActive(userId: string): Promise<readonly LinkedApp[]>;
  /** `false` when the caller has no such link. Revoking twice is a no-op, not an error. */
  revoke(userId: string, linkId: string): Promise<boolean>;
}

export const LINKED_APP_REPOSITORY = Symbol("LINKED_APP_REPOSITORY");

export class DrizzleLinkedAppRepository implements LinkedAppRepository {
  constructor(private readonly db: AppDb) {}

  async listActive(userId: string): Promise<readonly LinkedApp[]> {
    const rows = await this.db
      .select()
      .from(partnerLinks)
      .where(and(eq(partnerLinks.userId, userId), isNull(partnerLinks.revokedAt)))
      .orderBy(asc(partnerLinks.createdAt));
    return rows.map((row) => ({
      linkId: row.id,
      partnerId: row.partnerId,
      linkedAt: row.createdAt.toISOString(),
    }));
  }

  async revoke(userId: string, linkId: string): Promise<boolean> {
    const owned = and(eq(partnerLinks.id, linkId), eq(partnerLinks.userId, userId));
    const [revoked] = await this.db
      .update(partnerLinks)
      .set({ revokedAt: new Date() })
      .where(and(owned, isNull(partnerLinks.revokedAt)))
      .returning({ id: partnerLinks.id });
    if (revoked !== undefined) return true;
    const [existing] = await this.db
      .select({ id: partnerLinks.id })
      .from(partnerLinks)
      .where(owned)
      .limit(1);
    return existing !== undefined;
  }
}
