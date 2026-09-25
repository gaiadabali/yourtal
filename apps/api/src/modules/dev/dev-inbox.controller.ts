import { Controller, Get, Inject, NotFoundException } from "@nestjs/common";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  SIM_OUTBOX_READER,
  type PostgresSimOutboxReader,
} from "../../shared/drivers/postgres-sim-outbox-reader";
import type { DevInboxResponse } from "./dev-inbox.schema";

/**
 * `GET /api/dev/inbox` — 1.6.b. Reads `platform.sim_outbox` directly (see
 * `PostgresSimOutboxReader`'s own header for why that is a separate reader
 * rather than a method on `SimOutboxStore`), newest first, across every
 * boundary.
 *
 * ## `@PublicRoute`, not `@Authorize`
 *
 * `PdpGuard` is a global `APP_GUARD`, so an undeclared route is denied by
 * default (`docs/14` §4). This one is exempted the same way
 * `HealthController` is, but for the opposite-shaped reason: `HealthController`
 * carries no secrets, and this one carries only SIMULATED messages — there is
 * no real user data behind red line 11's "everything external is simulated"
 * — so there is nothing here for a capability check to protect either. What
 * actually gates this route is `appEnv`, checked below: `production` gets a
 * 404, matching F5's "staging is open, with a banner" (there is no
 * production deployment of this app at all yet, but the check exists for
 * when there is).
 */
@Controller("api/dev/inbox")
export class DevInboxController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SIM_OUTBOX_READER) private readonly outbox: PostgresSimOutboxReader,
  ) {}

  @PublicRoute(
    "A reviewer's inbox of SIMULATED messages (red line 11) — nothing here is a real user's " +
      "data, so there is no capability to check. Gated by APP_ENV instead (404 in production).",
  )
  @Get()
  async list(): Promise<DevInboxResponse> {
    if (this.config.appEnv === "production") {
      // 404, not 403: a route that refuses is still a route that exists,
      // and a production deployment should not even reveal that this one
      // does — the same reasoning `docs/14` gives for a tenant boundary,
      // applied to an environment boundary instead.
      throw new NotFoundException();
    }

    const records = await this.outbox.listRecent();
    return {
      entries: records.map((record) => ({
        id: record.id,
        boundary: record.boundary,
        region: record.region,
        recipient: record.recipient,
        category: record.category,
        ...(record.subject === undefined ? {} : { subject: record.subject }),
        body: record.body,
        // `platform.sim_outbox.metadata` is `NOT NULL DEFAULT '{}'`, so a
        // read row's `metadata` is never actually absent — this default
        // only satisfies `SimOutboxEntry`'s optional type, shared with the
        // write path where an absent value is meaningful.
        metadata: record.metadata ?? {},
        createdAt: record.createdAt.toISOString(),
      })),
    };
  }
}
