import type { SpambankApp, SpambankRegion } from "@yourtal/contracts/spambank/common";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { SpambankConfig } from "../../../config/spambank-config";
import type { RandomInt } from "../naming/generate";
import type { MailboxRecord, MailboxStore } from "../persistence/mailbox.store";
import { spambankUnavailable } from "./errors";

/** What every management use-case works with. */
export interface ManagementDeps {
  readonly store: MailboxStore;
  readonly driver: SpambankDriver;
  readonly config: SpambankConfig;
  /** `https://yourtal.gaiada.com`: where the proxy and its helper routes are served. */
  readonly publicOrigin: string;
  readonly log: {
    warn(message: string): void;
    error(message: string): void;
  };
  /** For tests. */
  readonly random?: RandomInt;
}

/** A person, already authorized by the layer above (a session and Cerbos, or an app's token and consent). */
export interface Person {
  readonly userId: string;
  readonly region: SpambankRegion;
}

export interface Caller {
  readonly person: Person;
  /** Who is asking: `yourtal` for a session, the app for its server. */
  readonly app: SpambankApp;
}

export const addressOf = (mailbox: Pick<MailboxRecord, "localPart" | "domain">): string =>
  `${mailbox.localPart}@${mailbox.domain}`;

/** The key that signs mail tokens, or the 503 a deployment without it should answer. */
export function tokenKeyOf(config: SpambankConfig): string {
  if (config.tokenKey === undefined) {
    throw spambankUnavailable("mail tokens are not configured on this server");
  }
  return config.tokenKey;
}
