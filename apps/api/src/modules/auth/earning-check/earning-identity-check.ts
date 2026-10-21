import type { Region } from "@yourtal/contracts/region";
import {
  identityCheckApplies,
  judgeEarningIdentity,
  POINTS_IDENTITY_CHECK_SETTING_KEY,
} from "@yourtal/contracts/identity/earning-check";
import type { EarningVerdict } from "@yourtal/contracts/identity/earning-check";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import type { CredentialRepository } from "../persistence/credential.repository";
import { PASSWORD_CREDENTIAL_KIND } from "../persistence/credential.repository";

export const EARNING_IDENTITY_CHECK = Symbol("EARNING_IDENTITY_CHECK");

/** "May this person earn points?" (F126). Every viewer earning path asks this before it holds or grants. */
export interface EarningIdentityCheck {
  verdictFor(userId: string, region: Region): Promise<EarningVerdict>;
}

export interface EarningIdentityCheckDeps {
  readonly appEnv: string;
  readonly settings: RegionSettingsReader;
  readonly credentials: Pick<CredentialRepository, "findByUserAndKind">;
}

/**
 * Reads the facts from the auth module's own repository: the sign-in email
 * is the password credential's identifier and is verified when it carries
 * `verified_at` (1.4.e). The facts are not read at all when the check does
 * not apply, so the demo world pays nothing for it.
 */
export class RepositoryEarningIdentityCheck implements EarningIdentityCheck {
  constructor(private readonly deps: EarningIdentityCheckDeps) {}

  async verdictFor(userId: string, region: Region): Promise<EarningVerdict> {
    const setting = await this.deps.settings.getSetting(region, POINTS_IDENTITY_CHECK_SETTING_KEY);
    const applies = identityCheckApplies(this.deps.appEnv, setting);
    if (!applies) return { mayEarn: true };

    const password = await this.deps.credentials.findByUserAndKind(
      userId,
      PASSWORD_CREDENTIAL_KIND,
    );
    return judgeEarningIdentity(true, {
      emailVerified: password !== null && password.verifiedAt !== null,
      email: password === null ? null : password.identifier,
    });
  }
}
