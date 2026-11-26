import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { SpambankApp } from "@yourtal/contracts/spambank/common";
import { ageBandOf } from "../oidc/claims";
import type { MachineClient, SignInClient } from "../oidc/clients";
import { isSignInClient } from "../oidc/clients";
import { OIDC_RUNTIME, OidcRuntime } from "../oidc/oidc-runtime";
import { NO_TEEN_INVITES, signInBlock } from "../oidc/sign-in-checks";
import { SPAMBANK_PG_POOL } from "./management.tokens";
import type { Caller } from "./use-cases/deps";
import { notAllowed, unknownSubject } from "./use-cases/errors";
import type { StatusSubject } from "./use-cases/status";

/** An app's server and the person it named, once every check passed. */
export interface ClientPerson {
  readonly caller: Caller;
  readonly subject: StatusSubject;
  readonly sector: string;
}

/** The apps that may mint a mail token (`a` in it); anything else never reaches the proxy. */
const APPS: Readonly<Record<string, SpambankApp>> = { snapapp: "snapapp", ftr: "ftr" };

/**
 * Resolves the person an app's server names (spambank/BUILD.md section 5.2). The person is always the
 * calling app's own pairwise `sub`, looked up in the client's sector, and the same checks a sign-in
 * makes apply: the app's consent is still standing, the account is verified and not on hold, in a
 * region the app takes, and an adult. Anything else answers like a person who does not exist or may
 * not use the service, and never says which.
 */
@Injectable()
export class SpambankClientPersonResolver {
  constructor(
    @Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime,
    @Inject(SPAMBANK_PG_POOL) private readonly pool: Pool,
  ) {}

  async resolve(client: MachineClient, sub: string, now: Date = new Date()): Promise<ClientPerson> {
    const app = APPS[client.app];
    const store = this.runtime.store;
    if (app === undefined || store === null) throw notAllowed();

    const found = await this.pool.query<{ user_id: string }>(
      "SELECT user_id FROM oidc.subject WHERE sector = $1 AND sub = $2",
      [client.sector, sub],
    );
    const userId = found.rows[0]?.user_id;
    if (userId === undefined) throw unknownSubject();
    const account = await store.findAccount(userId);
    if (account === null) throw unknownSubject();

    const consent = await store.findAppConsent(userId, client.sector);
    if (consent === null || consent.endedAt !== null) throw notAllowed();

    const signIn: SignInClient | undefined = this.runtime.clients
      .filter(isSignInClient)
      .find((one) => one.sector === client.sector);
    if (signIn !== undefined) {
      const block = await signInBlock(account, signIn, NO_TEEN_INVITES, undefined, now);
      if (!block.ok) throw notAllowed();
    } else if (account.suspended || !account.emailVerified) {
      throw notAllowed();
    }
    if (ageBandOf(account, now) !== "adult") throw notAllowed();

    return {
      caller: { person: { userId, region: account.region }, app },
      subject: { userId, adult: true, onHold: false },
      sector: client.sector,
    };
  }
}
