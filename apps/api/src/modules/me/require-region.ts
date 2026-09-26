import { NotFoundException } from "@nestjs/common";
import type { Region } from "@yourtal/contracts/region";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";

/**
 * The caller's real account region (F2), read from `identity.user_profile`.
 *
 * `PrincipalService.resolve()` — the synchronous, request-only resolver
 * this module's controllers inject — no longer decides `jurisdiction` at
 * all; `DEFAULT_JURISDICTION` in that file is a fixed placeholder ("ID")
 * left over from before `AsyncPrincipalResolver` took over the real
 * lookup for authorization. `AsyncPrincipalResolver` is not exposed to a
 * controller body (only `PdpGuard` uses it), so anywhere in `modules/me`
 * that needs the TRUE region — consent's jurisdiction, the follow F2 wall,
 * the streak clock — reads the profile directly, the same way
 * `WalletController.summary` already does.
 */
export async function requireRegion(
  profiles: Pick<UserProfileRepository, "findByUserId">,
  userId: string,
): Promise<Region> {
  const profile = await profiles.findByUserId(userId);
  if (profile === null) {
    throw new NotFoundException("No such profile.");
  }
  return profile.region;
}
