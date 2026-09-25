import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { campaigns } from "./schema/campaign.table";
import type {
  CampaignAuthzAttributes,
  CampaignAuthzAttributesReader,
  CampaignAuthzState,
} from "./campaign-authz-attributes";

const KNOWN_STATES: readonly CampaignAuthzState[] = [
  "draft",
  "in_review",
  "rejected",
  "live",
  "paused",
  "ended",
];

function toAuthzState(raw: string): CampaignAuthzState {
  const state = KNOWN_STATES.find((candidate) => candidate === raw);
  if (state === undefined) {
    // A genuinely unexpected bug, not a business-rule failure — the
    // migration's own CHECK constraint is the only thing that can put a
    // value in this column, so a value outside it means the constraint and
    // this list have drifted. Throwing (docs/13b §4) rather than smuggling
    // an unknown string into Cerbos, which would fail the resource schema's
    // enum validation with a far less useful error.
    throw new Error(`campaign.campaigns.lifecycle_state has an unrecognized value: ${raw}`);
  }
  return state;
}

export class DrizzleCampaignAuthzAttributesReader implements CampaignAuthzAttributesReader {
  constructor(private readonly db: AppDb) {}

  async findById(campaignId: string): Promise<CampaignAuthzAttributes | null> {
    const [row] = await this.db
      .select({
        lifecycleState: campaigns.lifecycleState,
        region: campaigns.region,
        audience: campaigns.audience,
        openViewing: campaigns.openViewing,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (row === undefined) return null;

    return {
      campaignId,
      state: toAuthzState(row.lifecycleState),
      region: row.region,
      audience: row.audience,
      openViewingEnabled: row.openViewing,
    };
  }
}
