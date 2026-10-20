import type { Region } from "@yourtal/contracts/region";

export interface PartnerLink {
  readonly id: string;
  readonly partnerId: string;
  readonly userId: string;
  readonly region: Region;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface NewPartnerLink {
  readonly partnerId: string;
  readonly userId: string;
  readonly region: Region;
}

/** `platform.partner_link` (14.3.a). */
export interface PartnerLinkRepository {
  /** The user's active link to this partner, created if there is none. */
  linkActive(input: NewPartnerLink): Promise<PartnerLink>;
  /** Any link by id, revoked or not; `null` if there is none. */
  findById(linkId: string): Promise<PartnerLink | null>;
  /**
   * Revokes this partner's link, or returns it unchanged if it is already
   * revoked. `null` when the partner has no link with this id.
   */
  revokeForPartner(partnerId: string, linkId: string): Promise<PartnerLink | null>;
}

export const PARTNER_LINK_REPOSITORY = Symbol("PARTNER_LINK_REPOSITORY");
