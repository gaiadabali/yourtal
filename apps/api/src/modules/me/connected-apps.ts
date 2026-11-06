import type { ConnectedAppId } from "@yourtal/contracts/me/connected-app";
import type { AppConfig } from "../../config/app-config";
import { clientsFor } from "../oidc/clients";

/** What YourTal's client registry says about each app, by pairwise-sub sector (docs/29 §5). */
export function appsBySector(
  config: AppConfig,
): Map<string, { app: ConnectedAppId; name: string; operator: string }> {
  return new Map(
    clientsFor(config.appEnv, config.oidc?.operators).map((client) => [
      client.sector,
      { app: client.app, name: client.name, operator: client.operator },
    ]),
  );
}
