import { randomBytes } from "node:crypto";
import { err, ok } from "neverthrow";
import { FaultEngine } from "../../fault-engine";
import type { FaultPlan } from "../../faults";
import { loginFor } from "./credentials";
import { injected, refused } from "./failures";
import type {
  AppPasswordSummary,
  SpambankAccountClient,
  SpambankDomain,
  SpambankDriver,
  SpambankFailure,
} from "./types";

/**
 * The simulated Spambank (BUILD.md §4.3): accounts and app passwords live in memory, and there is no
 * mail server behind them, so everything that would reach Stalwart as an account (JMAP, the proxy's
 * HTTP) answers a failure with code `simulated`. Callers map that to `503 simulated`.
 */

export interface SimulatedSpambankOptions {
  /** The domains it claims to serve. */
  readonly domains?: readonly string[];
  readonly faultPlan?: FaultPlan;
}

const NO_MAIL_SERVER: SpambankFailure = {
  kind: "server_error",
  boundary: "spambank",
  detail: "simulated: there is no mail server behind the simulated Spambank driver.",
  mayHaveSucceeded: false,
  code: "simulated",
};

interface SimAccount {
  readonly localPart: string;
  readonly domain: string;
  readonly appPasswords: Map<string, AppPasswordSummary>;
}

export function createSimulatedSpambank(options: SimulatedSpambankOptions = {}): SpambankDriver {
  const engine = new FaultEngine(options.faultPlan);
  const domains: SpambankDomain[] = (options.domains ?? []).map((name, index) => ({
    id: `sim-domain-${String(index + 1)}`,
    name,
  }));
  const accounts = new Map<string, SimAccount>();
  let sequence = 0;

  /** One fault decision per call, as every simulated boundary does. */
  function directive(): SpambankFailure | undefined {
    const next = engine.nextCall();
    return next === "proceed" ? undefined : injected(next);
  }

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${String(sequence)}`;
  }

  return {
    mode: "simulated",

    listDomains() {
      const fault = directive();
      return Promise.resolve(fault === undefined ? ok([...domains]) : err(fault));
    },

    createAccount(input) {
      const fault = directive();
      if (fault !== undefined) return Promise.resolve(err(fault));
      if (!domains.some((domain) => domain.name === input.domain)) {
        return Promise.resolve(
          err(refused("not_found", `The simulator does not serve ${input.domain}.`)),
        );
      }
      for (const account of accounts.values()) {
        if (account.localPart === input.localPart && account.domain === input.domain) {
          return Promise.resolve(err(refused("already_exists", "That name is taken.")));
        }
      }
      const accountId = nextId("sim-account");
      accounts.set(accountId, {
        localPart: input.localPart,
        domain: input.domain,
        appPasswords: new Map(),
      });
      return Promise.resolve(ok({ accountId, login: loginFor(input.localPart, input.domain) }));
    },

    destroyAccount(accountId) {
      const fault = directive();
      if (fault !== undefined) return Promise.resolve(err(fault));
      accounts.delete(accountId);
      return Promise.resolve(ok(undefined));
    },

    createAppPassword(accountId, name) {
      const fault = directive();
      if (fault !== undefined) return Promise.resolve(err(fault));
      const account = accounts.get(accountId);
      if (account === undefined)
        return Promise.resolve(err(refused("not_found", "No such account.")));
      const id = nextId("sim-apppw");
      const summary: AppPasswordSummary = { id, name, createdAt: new Date().toISOString() };
      account.appPasswords.set(id, summary);
      return Promise.resolve(
        ok({ ...summary, secret: `app_${randomBytes(18).toString("base64url")}` }),
      );
    },

    listAppPasswords(accountId) {
      const fault = directive();
      if (fault !== undefined) return Promise.resolve(err(fault));
      const account = accounts.get(accountId);
      if (account === undefined)
        return Promise.resolve(err(refused("not_found", "No such account.")));
      return Promise.resolve(ok([...account.appPasswords.values()]));
    },

    revokeAppPassword(accountId, appPasswordId) {
      const fault = directive();
      if (fault !== undefined) return Promise.resolve(err(fault));
      accounts.get(accountId)?.appPasswords.delete(appPasswordId);
      return Promise.resolve(ok(undefined));
    },

    account(localPart, domain): SpambankAccountClient {
      return {
        login: loginFor(localPart, domain),
        jmap: () => Promise.resolve(err(NO_MAIL_SERVER)),
        fetch: () => Promise.resolve(err(NO_MAIL_SERVER)),
      };
    },
  };
}
