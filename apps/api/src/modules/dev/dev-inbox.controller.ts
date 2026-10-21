import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  SIM_OUTBOX_READER,
  type PostgresSimOutboxReader,
} from "../../shared/drivers/postgres-sim-outbox-reader";
import type { SimOutboxRecord } from "@yourtal/drivers/sim-outbox";
import { STAFF_ROLE_READER } from "../identity/persistence/staff-role-reader";
import type { StaffRoleReader } from "../identity/persistence/staff-role-reader";
import { ACCOUNT_EMAIL_READER } from "../identity/persistence/account-email-reader";
import type { AccountEmailReader } from "../identity/persistence/account-email-reader";
import {
  decideInboxView,
  inboxEnvironment,
  type InboxEnvironment,
  type InboxViewer,
} from "./dev-inbox-visibility";
import type { DevInboxResponse } from "./dev-inbox.schema";

/**
 * `GET /api/dev/inbox` (1.6.b, 5.13.b): the simulated messages in
 * `platform.sim_outbox`, newest first.
 *
 * Those messages are simulated, but their bodies are not harmless: they
 * carry live email-verification, password-reset, guardian-consent and team
 * invitation links for real staging accounts. So who sees what is decided
 * by `decideInboxView` (`dev-inbox-visibility.ts`):
 * - `production`: 404, so the route does not even appear to exist.
 * - `dev`: open with no session, for local runs and the CI browser tests.
 * - `staging` (and anything else): a session is required (401 without one).
 *   Staff see every entry; anyone else only mail sent to their own sign-in
 *   email.
 *
 * ## `@PublicRoute`, not `@Authorize`
 *
 * The answer depends on the caller's own email, which no Cerbos policy can
 * see, and in `dev` it must answer with no session at all. So the PDP is
 * skipped and this controller resolves the session itself through
 * `PrincipalService`, the same resolver every other controller uses.
 */
@Controller("api/dev/inbox")
export class DevInboxController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SIM_OUTBOX_READER) private readonly outbox: PostgresSimOutboxReader,
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(STAFF_ROLE_READER) private readonly staffRoles: StaffRoleReader,
    @Inject(ACCOUNT_EMAIL_READER) private readonly emails: AccountEmailReader,
  ) {}

  @PublicRoute(
    "Outside dev, the controller resolves the session itself and shows a viewer only mail sent " +
      "to their own sign-in email (staff see all): a rule on the caller's email, which no " +
      "capability check can express. Open in dev with no session; 404 in production.",
  )
  @Get()
  async list(@Req() request: FastifyRequest): Promise<DevInboxResponse> {
    const environment = inboxEnvironment(this.config.appEnv);
    // Production refuses before anything is read; dev never reads a session,
    // so a stale cookie in a local run cannot turn into a 401.
    if (environment === "closed") throw new NotFoundException();
    const viewer = environment === "gated" ? await this.viewerOf(request) : null;

    const view = decideInboxView(this.config.appEnv, viewer, await this.read(environment, viewer));
    if (view.kind === "refused") {
      if (view.reason === "not_found") throw new NotFoundException();
      // Same code and message `PdpGuard` gives an anonymous caller (F30).
      throw new UnauthorizedException({ code: "no_session", message: "sign in to continue" });
    }

    return {
      access: view.access,
      viewerEmail: viewer?.email ?? null,
      entries: view.entries.map(toEntry),
    };
  }

  /** `null` when no credential was presented; a dead one is a 401 from `PrincipalService`. */
  private async viewerOf(request: FastifyRequest): Promise<InboxViewer | null> {
    const principal = await this.principals.resolve(request);
    if (principal.id === "anonymous") return null;
    const [roles, email] = await Promise.all([
      this.staffRoles.listForUser(principal.id),
      this.emails.emailFor(principal.id),
    ]);
    // Any staff role at all, the same test `AuthService.issueSession` uses.
    return { staff: roles.length > 0, email };
  }

  /**
   * Reads only what the rule could show: nothing for a caller about to be
   * refused, and a non-staff viewer's own address only, so their mail is not
   * crowded out of the newest 50 by everyone else's. `decideInboxView`
   * still filters what comes back.
   */
  private async read(
    environment: InboxEnvironment,
    viewer: InboxViewer | null,
  ): Promise<SimOutboxRecord[]> {
    if (environment === "gated" && viewer === null) return [];
    if (viewer !== null && !viewer.staff) {
      return viewer.email === null ? [] : this.outbox.listRecent(50, viewer.email);
    }
    return this.outbox.listRecent();
  }
}

function toEntry(record: SimOutboxRecord): DevInboxResponse["entries"][number] {
  return {
    id: record.id,
    boundary: record.boundary,
    region: record.region,
    recipient: record.recipient,
    category: record.category,
    ...(record.subject === undefined ? {} : { subject: record.subject }),
    body: record.body,
    // `platform.sim_outbox.metadata` is `NOT NULL DEFAULT '{}'`, so a read
    // row's `metadata` is never actually absent; this default only satisfies
    // `SimOutboxEntry`'s optional type, shared with the write path.
    metadata: record.metadata ?? {},
    createdAt: record.createdAt.toISOString(),
  };
}
