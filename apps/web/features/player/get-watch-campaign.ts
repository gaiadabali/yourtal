import type { Campaign } from "@yourtal/contracts/campaign";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import {
  generateCampaign,
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * Data access for the watch route (RSC-safe — called only from
 * `page.tsx`'s Server Component, never from a client leaf). Follows the
 * seam described in `@yourtal/contracts/mock-source`: one `resolveDataSource`
 * call, mock and live implementations behind it, and every screen imports
 * the resolved function rather than switching on the mode itself.
 *
 * There is no live implementation yet — Phase U ships against typed mocks
 * only (docs/tasks/phase-u-ui.md phase preamble) and no backend exists for
 * this route. `YOURTAL_DATA_SOURCE` defaults to "mock", so this only
 * throws if something explicitly opts into "live" before a real BFF client
 * lands here.
 */
export function getWatchCampaign(campaignId: string): Campaign {
  return resolveDataSource({
    mock: getWatchCampaignFromMocks,
    live: getWatchCampaignLive,
  })(campaignId);
}

const NAMED_FIXTURES: readonly Campaign[] = [
  zeroRewardCampaignFixture,
  longMerchantNameCampaignFixture,
];

/**
 * Looks the id up against the fixed mock catalogue first (so links from the
 * entry card, YT-0411, which reads from the same catalogue, resolve to the
 * exact same campaign). For any other id — a hand-typed URL, an id from a
 * catalogue this route doesn't share state with — it deterministically
 * synthesizes a campaign so the route never dead-ends in mock mode, using a
 * seed derived from the id string so the same URL always renders the same
 * campaign.
 */
function getWatchCampaignFromMocks(campaignId: string): Campaign {
  const known = [...mockCampaigns, ...NAMED_FIXTURES].find(
    (campaign) => campaign.id === campaignId,
  );
  if (known) {
    return known;
  }
  return generateCampaign({ seed: hashStringToSeed(campaignId) });
}

function getWatchCampaignLive(campaignId: string): Campaign {
  throw new Error(
    `getWatchCampaign: no live data source is implemented yet (requested campaignId="${campaignId}"). ` +
      "Phase U is mock-only per docs/tasks/phase-u-ui.md.",
  );
}
