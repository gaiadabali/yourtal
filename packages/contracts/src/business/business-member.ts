import { z } from "zod";
import { businessTeamRoleSchema } from "./business-team-role";

/**
 * A person's membership at one business — docs/17 section 2.1's six roles.
 *
 * The role here is `businessTeamRoleSchema`, NOT the `businessRoleSchema` in
 * `./business.ts`: that one is the three RELATIONSHIPS a business holds with
 * the platform (advertiser / supplier / redeemer), of which it may hold any
 * subset. This one is the job a PERSON does inside that business, and it is
 * exactly the enum `policies/derived_roles/business.yaml` reads out of
 * `P.attr.businessRoles` — so a member record feeds the PDP with no
 * translation step that could drift.
 *
 * Promoted from `apps/api/src/modules/business/domain/business-member.ts`
 * (YT-0100) into `@yourtal/contracts` (YT-0508) so the advertiser console
 * (YT-0440+) can share the shape instead of redefining it.
 */
export const businessMemberSchema = z.object({
  businessId: z.uuid(),
  userId: z.string().min(1),
  role: businessTeamRoleSchema,
  invitedAt: z.iso.datetime({ offset: true }),
  invitedByUserId: z.string().min(1),
  /** `null` until the invitee accepts. The owner's own row is joined immediately. */
  joinedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type BusinessMember = z.infer<typeof businessMemberSchema>;
