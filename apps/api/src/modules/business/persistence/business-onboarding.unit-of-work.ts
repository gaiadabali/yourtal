import type { Business } from "@yourtal/contracts/business";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { CreateBusinessAccountInput } from "./business-account.repository";

export interface CreateBusinessResult {
  readonly business: Business;
  readonly owner: BusinessMember;
}

/**
 * A business and its founding owner membership must exist together or not
 * at all — docs/17 section 2.1, "exactly one Owner". docs/13b section 7 says
 * transactions are opened in the use-case via `db.transaction`; that literal
 * shape is not available here, because the repository interface must stay
 * swappable for an in-memory fake that has no `db` to open a transaction on
 * (YT-0022 has not provisioned Postgres). Modelling the atomic step as one
 * named repository method is the deliberate compromise: `create-business.use-case.ts`
 * still owns the transactional boundary conceptually — it decides that
 * business-plus-owner is one unit and calls exactly one method for it — and
 * `DrizzleBusinessOnboardingUnitOfWork` is where `db.transaction` actually
 * appears. Flagged in the ticket report as a deviation worth a second look.
 */
export interface BusinessOnboardingUnitOfWork {
  createBusinessWithOwner(
    input: CreateBusinessAccountInput,
    ownerUserId: string,
  ): Promise<CreateBusinessResult>;
}

export const BUSINESS_ONBOARDING_UNIT_OF_WORK = Symbol("BUSINESS_ONBOARDING_UNIT_OF_WORK");
