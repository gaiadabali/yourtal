import type { ResultAsync } from "neverthrow";
import type { CreateBusinessAccountInput } from "../persistence/business-account.repository";
import type {
  BusinessOnboardingUnitOfWork,
  CreateBusinessResult,
} from "../persistence/business-onboarding.unit-of-work";
import type { CreateBusinessError } from "../business.errors";
import { wrapPersistence } from "../wrap-persistence";

/**
 * The signed-in caller who creates a business becomes its Owner immediately
 * — docs/17 section 2.1, "exactly one Owner". There is no PDP call here:
 * no business exists yet for Cerbos to reason about (there is no `team`
 * resource before this returns), so the only gate is "the caller is a real,
 * signed-in identity" — an authentication concern, not a capability one.
 * `business.controller.ts` enforces that by rejecting an anonymous
 * principal before this use-case is ever invoked.
 */
export function createBusiness(
  unitOfWork: BusinessOnboardingUnitOfWork,
  input: CreateBusinessAccountInput,
  ownerUserId: string,
): ResultAsync<CreateBusinessResult, CreateBusinessError> {
  return wrapPersistence(unitOfWork.createBusinessWithOwner(input, ownerUserId));
}
