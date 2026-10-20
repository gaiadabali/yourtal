import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { PartnerLinkRevokeResult } from "@yourtal/contracts/device/partner-action";
import type { LinkCodeLookup } from "../persistence/link-code-lookup";
import type { AccountAgeLookup } from "../persistence/account-age-lookup";
import type { PartnerLink, PartnerLinkRepository } from "../persistence/partner-link.repository";
import type { PartnerLinkError } from "../partners.errors";
import { wrapPersistence } from "../wrap-persistence";

export interface PartnerLinkDeps {
  readonly linkCodes: LinkCodeLookup;
  readonly ages: AccountAgeLookup;
  readonly links: PartnerLinkRepository;
}

/**
 * 14.3.b: spends the user's one-time code and returns their lasting link to
 * this partner, creating it if they have none. The code is claimed first and
 * atomically, so it works once even under concurrent calls; a user who is
 * already linked gets the same link back (one active link per partner).
 */
export function linkPartnerAccount(
  deps: PartnerLinkDeps,
  input: { readonly partnerId: string; readonly code: string },
): ResultAsync<PartnerLink, PartnerLinkError> {
  return wrapPersistence(deps.linkCodes.claim(input.code)).andThen((claimed) => {
    if (claimed === null) {
      return errAsync<PartnerLink, PartnerLinkError>({ type: "invalid_link_code" });
    }
    return wrapPersistence(deps.ages.ageBandOf(claimed.userId)).andThen((ageBand) => {
      // No profile means the account is gone; the code is as good as unknown.
      if (ageBand === null) {
        return errAsync<PartnerLink, PartnerLinkError>({ type: "invalid_link_code" });
      }
      if (ageBand !== "adult") {
        return errAsync<PartnerLink, PartnerLinkError>({ type: "teen_not_allowed" });
      }
      return wrapPersistence(
        deps.links.linkActive({
          partnerId: input.partnerId,
          userId: claimed.userId,
          region: claimed.region,
        }),
      );
    });
  });
}

/**
 * 14.3.b: a later call names the link by id. Another partner's link reads
 * as unknown, never as "exists"; a revoked one says so, so the partner can
 * ask the user to link again. A link whose account was deleted reads as
 * revoked even before the deletion's own revoke has run (the DSAR
 * `partner_links` domain), so nothing is ever granted to a deleted account.
 */
export function resolveActiveLink(
  deps: Pick<PartnerLinkDeps, "links" | "ages">,
  input: { readonly partnerId: string; readonly linkId: string },
): ResultAsync<PartnerLink, PartnerLinkError> {
  return wrapPersistence(deps.links.findById(input.linkId)).andThen((link) => {
    if (link?.partnerId !== input.partnerId) {
      return errAsync<PartnerLink, PartnerLinkError>({ type: "unknown_link" });
    }
    if (link.revokedAt !== null) {
      return errAsync<PartnerLink, PartnerLinkError>({ type: "link_revoked" });
    }
    return wrapPersistence(deps.ages.ageBandOf(link.userId)).andThen((ageBand) =>
      ageBand === null
        ? errAsync<PartnerLink, PartnerLinkError>({ type: "link_revoked" })
        : okAsync<PartnerLink, PartnerLinkError>(link),
    );
  });
}

/**
 * The partner ends a link. Only its own: another partner's link, or an id
 * that names nothing, is `unknown_link`. Revoking twice answers the same.
 */
export function revokePartnerLink(
  links: PartnerLinkRepository,
  input: { readonly partnerId: string; readonly linkId: string },
): ResultAsync<PartnerLinkRevokeResult, PartnerLinkError> {
  return wrapPersistence(links.revokeForPartner(input.partnerId, input.linkId)).andThen((link) => {
    if (link === null) {
      return errAsync<PartnerLinkRevokeResult, PartnerLinkError>({ type: "unknown_link" });
    }
    if (link.revokedAt === null) {
      return errAsync<PartnerLinkRevokeResult, PartnerLinkError>({
        type: "persistence_failed",
        cause: `partner link ${link.id} is still active after a revoke`,
      });
    }
    return okAsync<PartnerLinkRevokeResult, PartnerLinkError>({
      linkId: link.id,
      revokedAt: link.revokedAt,
    });
  });
}
