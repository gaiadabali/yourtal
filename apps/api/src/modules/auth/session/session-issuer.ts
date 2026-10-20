import { Inject, Injectable } from "@nestjs/common";
import { STAFF_ROLE_READER } from "../../identity/persistence/staff-role-reader";
import type { StaffRoleReader } from "../../identity/persistence/staff-role-reader";
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
  ) {}

  async issue(userId: string, now: Date, amr: readonly AuthMethod[]): Promise<string> {
    const roles = await this.staffRoles.listForUser(userId);
    return this.sessions.issue(userId, now, roles.length > 0 ? "staff" : "consumer", amr);
  }
}
