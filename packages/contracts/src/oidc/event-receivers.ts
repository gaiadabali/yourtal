/**
 * Group 3.7 (docs/29 §5): the apps that receive YourTal's signed events (docs/26 §2),
 * one receiver per sector. The API reads it for deletion and withdrawal, the worker
 * to send. `oidc.forget_subject` takes these entries as JSON, so a sector missing here
 * is never told (`sectorsWithoutReceiver` is what the registry test runs).
 *
 * Production has no sign-in clients yet, so it has no receiver: its list is empty and
 * the clients' production rows get entries here when F108 lets real users in.
 */
export type ReceiverEnvironment = "dev" | "staging" | "production";

export interface EventReceiver {
  /** The pairwise-`sub` sector the person signed in under. */
  readonly sector: string;
  /** The client that receives the app's events (`aud`). */
  readonly clientId: string;
  readonly endpoint: string;
  readonly environments: readonly ReceiverEnvironment[];
}

export const EVENT_RECEIVERS: readonly EventReceiver[] = [
  {
    sector: "snapapp-staging",
    clientId: "snapapp-staging-server",
    endpoint: "https://snap-apps-api.gaiada.com/v1/yourtal/events",
    environments: ["dev", "staging"],
  },
  {
    // F124: FTR has no staging site; staging posts to its production endpoint.
    sector: "ftr",
    clientId: "ftr-web",
    endpoint: "https://freetaxreturns.com.au/api/yourtal/events",
    environments: ["dev", "staging"],
  },
];

export function receiversFor(environment: ReceiverEnvironment): readonly EventReceiver[] {
  return EVENT_RECEIVERS.filter((receiver) => receiver.environments.includes(environment));
}

/** Sectors that have a client in some environment where no receiver covers that sector there. */
export function sectorsWithoutReceiver(
  clients: readonly { sector: string; environments: readonly ReceiverEnvironment[] }[],
  receivers: readonly EventReceiver[] = EVENT_RECEIVERS,
): string[] {
  const missing = new Set<string>();
  for (const client of clients) {
    for (const environment of client.environments) {
      const covered = receivers.some(
        (receiver) =>
          receiver.sector === client.sector && receiver.environments.includes(environment),
      );
      if (!covered) missing.add(`${client.sector}@${environment}`);
    }
  }
  return [...missing].sort();
}
