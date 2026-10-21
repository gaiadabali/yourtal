import { Inject, Injectable } from "@nestjs/common";
import { STAFF_ROLE_READER } from "../../identity/persistence/staff-role-reader";
import type { StaffRoleReader } from "../../identity/persistence/staff-role-reader";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { AUTH_DB } from "../persistence/auth-db.token";
import { factorStillPresent, lockAccount } from "../persistence/factor-lock";
import type { UsedFactor } from "../persistence/factor-lock";
import type { AuthMethod } from "./amr";
import { SessionService } from "./session.service";

/**
 * 1.5.e, F12: every session-minting call goes through here rather than
 * `SessionService.issue`, so a staff account never gets a 90-day session by
 * accident. Staff sign in through the same routes as everyone else, so the
 * two kinds are told apart only by whether `identity.staff_role` names this
 * user, read fresh each time so a grant or revocation applies at the next
 * sign-in. `amr` records how the person proved who they are.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    @Inject(STAFF_ROLE_READER) private readonly staffRoles: StaffRoleReader,
    private readonly sessions: SessionService,
    @Inject(AUTH_DB) private readonly db: AppDb,
  ) {}

  /** `signedInAt` is for a replacement session, which keeps the original sign-in time. */
  async issue(
    userId: string,
    now: Date,
    amr: readonly AuthMethod[],
    signedInAt: Date = now,
  ): Promise<string> {
    const roles = await this.staffRoles.listForUser(userId);
    const kind = roles.length > 0 ? "staff" : "consumer";
    return this.sessions.issue(userId, now, kind, amr, signedInAt);
  }

  /**
   * For a passkey or code sign-in: writes the session only if the factor it
   * used still exists, holding the account lock `FOR SHARE` meanwhile. A
   * password reset removing every factor holds it `FOR UPDATE`, so a sign-in
   * that passed its check just before cannot leave a session behind after it.
   * Null: the factor is gone.
   */
  async issueWhileFactorRemains(
    userId: string,
    now: Date,
    amr: readonly AuthMethod[],
    factor: UsedFactor,
  ): Promise<string | null> {
    const roles = await this.staffRoles.listForUser(userId);
    const kind = roles.length > 0 ? "staff" : "consumer";
    return this.db.transaction(async (tx) => {
      await lockAccount(tx, userId, "share");
      if (!(await factorStillPresent(tx, userId, factor))) return null;
      return this.sessions.issue(userId, now, kind, amr, now, tx);
    });
  }
}
