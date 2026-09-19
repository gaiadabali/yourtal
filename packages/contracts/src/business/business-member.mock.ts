import type { BusinessMember } from "./business-member";
import { businessMemberSchema } from "./business-member";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";

export interface GenerateBusinessMemberParams {
  seed: number;
  now?: Date | undefined;
}

const ALL_BUSINESS_MEMBER_ROLES = [
  "owner",
  "admin",
  "marketer",
  "merchandiser",
  "finance",
  "analyst",
] as const;

/** Generates one deterministic, realistic business membership row for the given seed. */
export function generateBusinessMember(params: GenerateBusinessMemberParams): BusinessMember {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const invitedDaysAgo = faker.number.int({ min: 0, max: 90 });
  const hasJoined = faker.datatype.boolean({ probability: 0.85 });
  const joinedDaysAfterInvite = faker.number.int({ min: 0, max: Math.min(invitedDaysAgo, 5) });

  return businessMemberSchema.parse({
    businessId: faker.string.uuid(),
    userId: faker.string.uuid(),
    role: faker.helpers.arrayElement(ALL_BUSINESS_MEMBER_ROLES),
    invitedAt: toIsoString(addDays(now, -invitedDaysAgo)),
    invitedByUserId: faker.string.uuid(),
    joinedAt: hasJoined ? toIsoString(addDays(now, -invitedDaysAgo + joinedDaysAfterInvite)) : null,
  });
}

/** Generates `count` deterministic business members from a base seed. */
export function generateBusinessMembers(
  count: number,
  baseSeed: number,
  now?: Date,
): BusinessMember[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateBusinessMember({ seed: baseSeed + index, now }),
  );
}

/** A membership that has been invited but has not yet accepted — the pending-invite awkward case. */
export const pendingInviteBusinessMemberFixture: BusinessMember = businessMemberSchema.parse({
  businessId: "00000000-0000-4000-8000-000000000601",
  userId: "00000000-0000-4000-8000-000000000701",
  role: "marketer",
  invitedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -2)),
  invitedByUserId: "00000000-0000-4000-8000-000000000601",
  joinedAt: null,
});

export const mockBusinessMembers: BusinessMember[] = generateBusinessMembers(8, 7_000);
