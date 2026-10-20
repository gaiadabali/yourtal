import {
  charityConsoleSchema,
  charityDetailListSchema,
  publicCharityListSchema,
} from "@yourtal/contracts/charity";
import { publicCharitySchema } from "@yourtal/contracts/charity";
import type { CharityConsole, CharityDetail, PublicCharity } from "@yourtal/contracts/charity";
import {
  charityPayoutsSchema,
  payoutLinkSchema,
  type CharityPayouts,
  type PayoutLink,
} from "@yourtal/contracts/billing/payouts";
import { apiFetch } from "@/lib/api/api-fetch";
import { getRegion } from "@/features/region/get-region";

/** 13.21.b: approved charities in the viewer's region (their own when signed in). */
export async function listCharities(): Promise<PublicCharity[]> {
  const region = await getRegion();
  const result = await apiFetch(`/api/charities?region=${region}`, publicCharityListSchema);
  if (result.ok) return result.data.charities;
  // Signed in with the other region's cookie: the API answers for the account's own region.
  const own = await apiFetch("/api/charities", publicCharityListSchema);
  return own.ok ? own.data.charities : [];
}

/** 13.21.b: the same list for the viewer pages, `null` when the read fails (so the page can say so). */
export async function listCharitiesOrNull(): Promise<PublicCharity[] | null> {
  const result = await apiFetch("/api/charities", publicCharityListSchema);
  return result.ok ? result.data.charities : null;
}

/** One approved charity in the caller's region: `missing` on a 404, `null` on any other failure. */
export async function getCharity(charityId: string): Promise<PublicCharity | null | "missing"> {
  const result = await apiFetch(
    `/api/charities/${encodeURIComponent(charityId)}`,
    publicCharitySchema,
  );
  if (result.ok) return result.data;
  return result.error.kind === "http" && result.error.status === 404 ? "missing" : null;
}

/** `null` when the caller is not signed in. */
export async function listMyCharities(): Promise<CharityDetail[] | null> {
  const result = await apiFetch("/api/me/charities", charityDetailListSchema);
  return result.ok ? result.data.charities : null;
}

export async function loadCharityConsole(charityId: string): Promise<CharityConsole | null> {
  const result = await apiFetch(
    `/api/charities/${encodeURIComponent(charityId)}/console`,
    charityConsoleSchema,
  );
  return result.ok ? result.data : null;
}

export async function listCharitiesForStaff(state?: string): Promise<CharityDetail[]> {
  const query = state === undefined ? "" : `?state=${encodeURIComponent(state)}`;
  const result = await apiFetch(`/api/staff/charities${query}`, charityDetailListSchema);
  if (!result.ok) throw new Error(`Could not load charities: ${result.error.message}`);
  return result.data.charities;
}

/** 5.2: where this charity's auction proceeds are paid. A failed read hides the panel rather than breaking the console. */
export async function getCharityPayouts(charityId: string): Promise<CharityPayouts> {
  const result = await apiFetch(
    `/api/charities/${encodeURIComponent(charityId)}/payouts`,
    charityPayoutsSchema,
  );
  return result.ok
    ? result.data
    : {
        account: {
          available: false,
          state: "not_started",
          bankLast4: null,
          hostedOnboarding: false,
        },
      };
}

/** The processor's onboarding page for this charity. Throws when it cannot be opened. */
export async function startCharityPayoutLink(charityId: string): Promise<PayoutLink> {
  const result = await apiFetch(
    `/api/charities/${encodeURIComponent(charityId)}/payouts/link`,
    payoutLinkSchema,
    { method: "POST", body: {} },
  );
  if (!result.ok) throw new Error(`Could not open payout details: ${result.error.message}`);
  return result.data;
}
