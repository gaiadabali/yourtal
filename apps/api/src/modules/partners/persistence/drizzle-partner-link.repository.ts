import { and, eq, isNull } from "drizzle-orm";
import { regionSchema } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { partnerLinks } from "./schema/partner.table";
import type { NewPartnerLink, PartnerLink, PartnerLinkRepository } from "./partner-link.repository";

type Row = typeof partnerLinks.$inferSelect;

function toLink(row: Row): PartnerLink {
  return {
    id: row.id,
    partnerId: row.partnerId,
    userId: row.userId,
    region: regionSchema.parse(row.region),
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export class DrizzlePartnerLinkRepository implements PartnerLinkRepository {
  constructor(private readonly db: AppDb) {}

  async linkActive(input: NewPartnerLink): Promise<PartnerLink> {
    // The only conflict possible is the partial unique index on the active
    // (partner, user) pair, so a user already linked keeps their link.
    const [inserted] = await this.db
      .insert(partnerLinks)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return toLink(inserted);

    const [existing] = await this.db
      .select()
      .from(partnerLinks)
      .where(
        and(
          eq(partnerLinks.partnerId, input.partnerId),
          eq(partnerLinks.userId, input.userId),
          isNull(partnerLinks.revokedAt),
        ),
      )
      .limit(1);
    if (existing === undefined) {
      throw new Error("partner link conflicted but no active link was found");
    }
    return toLink(existing);
  }

  async revokeForPartner(partnerId: string, linkId: string): Promise<PartnerLink | null> {
    const owned = and(eq(partnerLinks.id, linkId), eq(partnerLinks.partnerId, partnerId));
    const [revoked] = await this.db
      .update(partnerLinks)
      .set({ revokedAt: new Date() })
      .where(and(owned, isNull(partnerLinks.revokedAt)))
      .returning();
    if (revoked !== undefined) return toLink(revoked);
    const [existing] = await this.db.select().from(partnerLinks).where(owned).limit(1);
    return existing === undefined ? null : toLink(existing);
  }

  async findById(linkId: string): Promise<PartnerLink | null> {
    const [row] = await this.db
      .select()
      .from(partnerLinks)
      .where(eq(partnerLinks.id, linkId))
      .limit(1);
    return row === undefined ? null : toLink(row);
  }
}
