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
import type { PasskeyRepository } from "../persistence/passkey.repository";

export const EARNING_IDENTITY_CHECK = Symbol("EARNING_IDENTITY_CHECK");

/** "May this person earn points?" (F126). Every viewer earning path asks this before it holds or grants. */
export interface EarningIdentityCheck {
  verdictFor(userId: string, region: Region): Promise<EarningVerdict>;
}

export interface EarningIdentityCheckDeps {
  readonly appEnv: string;
  readonly settings: RegionSettingsReader;
  readonly credentials: Pick<CredentialRepository, "findByUserAndKind">;
  readonly passkeys: Pick<PasskeyRepository, "listForUser">;
}

/**
 * Reads the facts from the auth module's own repositories: the email is
 * verified when the password credential carries `verified_at` (1.4.e), and a
 * passkey is a row in `identity.passkey`. The facts are not read at all when
 * the check does not apply, so the demo world pays nothing for it.
 */
export class RepositoryEarningIdentityCheck implements EarningIdentityCheck {
  constructor(private readonly deps: EarningIdentityCheckDeps) {}

  async verdictFor(userId: string, region: Region): Promise<EarningVerdict> {
    const setting = await this.deps.settings.getSetting(region, POINTS_IDENTITY_CHECK_SETTING_KEY);
    const applies = identityCheckApplies(this.deps.appEnv, setting);
    if (!applies) return { mayEarn: true };

    const [password, passkeys] = await Promise.all([
      this.deps.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND),
      this.deps.passkeys.listForUser(userId),
    ]);
    return judgeEarningIdentity(true, {
      emailVerified: password !== null && password.verifiedAt !== null,
      passkeyCount: passkeys.length,
    });
  }
}
