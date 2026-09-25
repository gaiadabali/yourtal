import { randomUUID } from "node:crypto";
import type { AppDb } from "../persistence/drizzle-client";
import { businessAccounts } from "../../modules/business/persistence/schema/business-account.table";
import { businessMembers } from "../../modules/business/persistence/schema/business-member.table";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import type { Region } from "@yourtal/contracts/region";

/**
 * 1.5.a: a real `business.business_accounts` + `business.business_members`
 * row (with `joined_at` set), for tests that need `AsyncPrincipalResolver`'s
 * real 1.5.b overlay to produce a `business_user` role — the
 * `x-yt-business-roles` header this used to be faked through is gone.
 * `yourtal_app` holds INSERT on both tables (20260919000003_business.sql),
 * so this runs on the ordinary app connection, no owner pool needed.
 */
export async function seedBusinessMembership(
  db: AppDb,
  args: { readonly userId: string; readonly role: BusinessTeamRole; readonly region?: Region },
): Promise<string> {
  const businessId = randomUUID();
  const region = args.region ?? "AU";
  await db.insert(businessAccounts).values({
    id: businessId,
    legalName: "1.5.a Test Business Pty Ltd",
    displayName: "1.5.a Test Business",
    district: "Test District",
    roles: ["advertiser"],
    region,
    currency: region === "AU" ? "AUD" : "IDR",
    handle: `biz-1-5-a-${randomUUID().slice(0, 8)}`,
  });
  await db.insert(businessMembers).values({
    businessId,
    userId: args.userId,
    role: args.role,
    invitedByUserId: args.userId,
    joinedAt: new Date(),
  });
  return businessId;
}
