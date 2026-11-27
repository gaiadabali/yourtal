import * as z from "zod";
import { teamMemberSchema } from "@yourtal/contracts/business/member";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { demoProfiles, profilesFromTeam } from "./studio-member-directory";
import type { MemberProfiles } from "./studio-member-directory";
import { resolveStudioDataSource } from "./studio-data-source";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * The Team zone's own roster read, separate from `studio-data.ts`'s
 * `BusinessMembership.roster` (which every zone's `page.tsx` gets cheaply
 * for free and which mock mode already populates correctly). Only Team
 * itself needs the REAL roster, and only Team-zone `view`-capable callers
 * are ever authorized to read it (`policies/resource_policies/team.yaml`) —
 * fetching it for every business on every Studio page load, the way
 * `listMyBusinesses` would have to, would be wasted work at best and a 403
 * at worst for a business where the caller holds a non-team-managing role.
 *
 * Mock mode has no separate roster of its own: `fallback` is exactly
 * `current.roster` from `studio-data.ts`'s existing mock membership, so
 * this seam adds nothing new to maintain for the mock flow.
 */
export interface TeamDirectory {
  roster: BusinessMember[];
  /** Who each member is: their real name and email live, the demo cast in mock mode. */
  profiles: MemberProfiles;
}

interface TeamDataSource {
  listTeam: (businessId: string, fallback: BusinessMember[]) => Promise<TeamDirectory>;
}

const mockDataSource: TeamDataSource = {
  listTeam: (_businessId, fallback) =>
    Promise.resolve({ roster: fallback, profiles: demoProfiles(fallback) }),
};

const teamResponseSchema = z.array(teamMemberSchema);

/** Live: `GET /api/:tenantId/business/team` (7.1.d's team directory, merged to `main`). */
const liveDataSource: TeamDataSource = {
  listTeam: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/business/team`, teamResponseSchema);
    if (!result.ok) throw new Error(`Could not load the team roster: ${result.error.message}`);
    return { roster: result.data, profiles: profilesFromTeam(result.data) };
  },
};

const teamDataSource = resolveStudioDataSource({ mock: mockDataSource, live: liveDataSource });

/** The business's real roster and who each member is (live), or its existing mock roster (mock). */
export function listTeam(businessId: string, fallback: BusinessMember[]): Promise<TeamDirectory> {
  return teamDataSource.listTeam(businessId, fallback);
}
