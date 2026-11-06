import { Controller, Delete, Get, Inject, NotFoundException, Param, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  connectedAppIdSchema,
  type ConnectedAppsResponse,
  type RemoveConnectedAppResponse,
} from "@yourtal/contracts/me/connected-app";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { appsBySector } from "./connected-apps";
import { ME_PG_POOL } from "./me.tokens";
import type { MePgPool } from "./me.tokens";
import { DATA_EXPORT_READER } from "./persistence/data-export.reader";
import type { DataExportReader } from "./persistence/data-export.reader";

/**
 * Me → Linked apps, the apps a person signs in to with YourTal (group 3.7 Y3, docs/29 §5).
 * Reads `oidc.app_consent`, never `GET /api/me/consents`: that groups by purpose, so one
 * app's withdrawal would hide another's consent. Removal is `oidc.end_app_access`: it ends
 * the consent, records the withdrawal, and queues `access-ended` for the app's receiver.
 */
@Controller("api/me/connected-apps")
export class ConnectedAppsController {
  constructor(
    // The async resolver: `ageBand` picks `teen_removed` over `user_removed`.
    private readonly principals: AsyncPrincipalResolver,
    @Inject(ME_PG_POOL) private readonly pool: MePgPool,
    @Inject(DATA_EXPORT_READER) private readonly reader: DataExportReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Authorize({ kind: "me", action: "view_connected_apps" })
  @NotValueMoving("A read of the caller's own app consents.")
  @Get()
  async list(@Req() request: FastifyRequest): Promise<ConnectedAppsResponse> {
    const userId = (await this.principals.resolve(request)).id;
    const apps = appsBySector(this.config);
    const connectedApps: ConnectedAppsResponse["connectedApps"] = [];
    for (const row of await this.reader.connectedApps(userId)) {
      const known = apps.get(row.sector);
      if (row.endedAt === null && known !== undefined) {
        connectedApps.push({
          ...known,
          scopes: [...row.scopes],
          grantedAt: row.grantedAt.toISOString(),
        });
      }
    }
    return { connectedApps };
  }

  @NotValueMoving(
    "Removing twice ends in the same state as once: the second finds no live consent.",
  )
  @Authorize({ kind: "me", action: "remove_connected_app" })
  @Delete(":app")
  async remove(
    @Req() request: FastifyRequest,
    @Param("app") rawApp: string,
  ): Promise<RemoveConnectedAppResponse> {
    const app = connectedAppIdSchema.safeParse(rawApp);
    const sector = [...appsBySector(this.config)].find(([, one]) => one.app === app.data)?.[0];
    if (!app.success || sector === undefined) {
      throw new NotFoundException({ code: "unknown_app", message: "No such app." });
    }
    const principal = await this.principals.resolve(request);
    const receiver = receiversFor(this.config.appEnv).find((one) => one.sector === sector);
    const end = async (reason: string): Promise<boolean> =>
      (
        await this.pool.query<{ ended: boolean }>(
          "SELECT oidc.end_app_access($1, $2, $3, $4) AS ended",
          [principal.id, sector, receiver?.clientId ?? null, reason],
        )
      ).rows[0]?.ended === true;
    // A repeat finds no live consent and writes nothing. `teen_removed` ends only an invite's
    // consent: anything else a teen holds (or a birthday mid-call) ends as an ordinary removal.
    if (principal.attr.ageBand !== "teen" || !(await end("teen_removed")))
      await end("user_removed");
    return { app: app.data, connected: false };
  }
}
