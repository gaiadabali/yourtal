/**
 * 1.5.d (EW-03): the campaign facts `campaign_view.yaml`'s rules reason
 * about, read directly rather than through `CampaignRepository`.
 *
 * `CampaignRepository`'s own doc comment is explicit that the AUTHORING
 * state (`draft`, `in_review`, `rejected`) never leaves that layer, and maps
 * everything else onto a viewer-facing `status` (`active | paused | ended`).
 * That is the right rule for a response body. It is the wrong rule here: an
 * authorization attribute is never returned to a client, and the policy
 * needs to tell a paused campaign from a still-in-review one (both would
 * otherwise collapse to the same "not active" bucket). So this reads
 * `lifecycle_state` as it is — a second, narrower port over the same table,
 * the same shape `BusinessRegionLookup` uses for a cross-cutting read that
 * does not belong on the public repository's contract.
 */
export type CampaignAuthzState = "draft" | "in_review" | "rejected" | "live" | "paused" | "ended";

export interface CampaignAuthzAttributes {
  readonly campaignId: string;
  readonly state: CampaignAuthzState;
  readonly region: string;
  readonly audience: string;
  readonly openViewingEnabled: boolean;
}

export interface CampaignAuthzAttributesReader {
  /** `null` when no campaign with this id exists at all (not even a draft). */
  findById(campaignId: string): Promise<CampaignAuthzAttributes | null>;
}

export const CAMPAIGN_AUTHZ_ATTRIBUTES_READER = Symbol("CAMPAIGN_AUTHZ_ATTRIBUTES_READER");
