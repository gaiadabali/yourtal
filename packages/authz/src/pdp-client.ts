import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { ActionDecisions, AuthzError } from "./decision";
import type { Principal } from "./principal";
import type { ActionFor, Resource, ResourceKind } from "./resources";

/**
 * The policy decision point client — the only way anything in this codebase
 * is allowed to answer "may this principal do that".
 *
 * Written against the Cerbos Check Resources API directly rather than through
 * the official SDK. That is a deliberate application of docs/14 section 7:
 * this is one HTTP call with a stable request shape, the response is parsed
 * by a schema we control, and a dependency in the value zone costs two human
 * approvals. A one-line utility is written, not installed.
 *
 * Deployment shape, for whoever wires this up in YT-0500: Cerbos is a
 * STATELESS SIDECAR (docs/10, docs/15). It runs next to the service, the
 * base URL is a loopback address, and policies reach it from this repo's
 * `policies/` directory. It is not a network hop to a shared cluster
 * service — an authorization check on the request path cannot afford one,
 * and a shared PDP is a single point of failure for every deny in the system.
 */

const DEFAULT_TIMEOUT_MS = 500;

/** Cerbos returns these; anything else is a protocol error, not a deny. */
const effectSchema = z.enum([
  "EFFECT_ALLOW",
  "EFFECT_DENY",
  "EFFECT_NO_MATCH",
  "EFFECT_UNSPECIFIED",
]);

const checkResponseSchema = z.object({
  results: z
    .array(
      z.object({
        resource: z.object({ kind: z.string(), id: z.string() }),
        actions: z.record(z.string(), effectSchema),
      }),
    )
    .min(1),
});

export interface PdpClientConfig {
  /**
   * Base URL of the Cerbos sidecar, e.g. `http://127.0.0.1:3592`. Read from
   * the one Zod-parsed config object at bootstrap (docs/13b section 7), never
   * from `process.env` at the call site.
   */
  readonly baseUrl: string;
  /**
   * How long to wait before giving up. Deliberately short: this call sits on
   * the request path, and a slow PDP must become a fast, loud failure rather
   * than a slow one. Exceeding it yields `pdp_unavailable`, never an ALLOW.
   */
  readonly timeoutMs?: number;
  /** Injectable for tests. Defaults to the global `fetch` (Node 22+). */
  readonly fetchImpl?: typeof fetch;
}

export interface PdpClient {
  /**
   * Asks about several actions on one resource in a single round trip.
   * Prefer this over one call per action — the PDP evaluates the whole set
   * for the same cost, and a UI that greys out what you cannot do needs all
   * the answers anyway.
   */
  checkResource<K extends ResourceKind>(
    principal: Principal,
    resource: Resource<K>,
    actions: readonly ActionFor<K>[],
  ): ResultAsync<ActionDecisions<K>, AuthzError>;

  /**
   * The guard form: succeeds with nothing, or fails with `forbidden`. This
   * is what a route handler calls. It returns a Result rather than throwing
   * so that `neverthrow/must-use-result` makes an unhandled authorization
   * check a build failure instead of a production incident.
   */
  requireAction<K extends ResourceKind>(
    principal: Principal,
    resource: Resource<K>,
    action: ActionFor<K>,
  ): ResultAsync<void, AuthzError>;
}

export function createPdpClient(config: PdpClientConfig): PdpClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/api/check/resources`;

  function checkResource<K extends ResourceKind>(
    principal: Principal,
    resource: Resource<K>,
    actions: readonly ActionFor<K>[],
  ): ResultAsync<ActionDecisions<K>, AuthzError> {
    if (actions.length === 0) {
      return errAsync({
        type: "pdp_protocol_error",
        cause: "checkResource called with no actions",
      });
    }

    const body = JSON.stringify({
      requestId: crypto.randomUUID(),
      principal: { id: principal.id, roles: principal.roles, attr: principal.attr },
      resources: [
        {
          actions: [...actions],
          resource: { kind: resource.kind, id: resource.id, attr: resource.attr },
        },
      ],
    });

    return ResultAsync.fromPromise(
      doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      (cause): AuthzError => ({ type: "pdp_unavailable", cause: String(cause) }),
    )
      .andThen((response) =>
        response.ok
          ? ResultAsync.fromPromise(response.json(), (cause): AuthzError => ({
              type: "pdp_protocol_error",
              cause: `response body was not JSON: ${String(cause)}`,
            }))
          : errAsync<unknown, AuthzError>({
              type: "pdp_unavailable",
              cause: `PDP returned HTTP ${String(response.status)}`,
            }),
      )
      .andThen((payload) => parseDecisions(payload, resource, actions));
  }

  function requireAction<K extends ResourceKind>(
    principal: Principal,
    resource: Resource<K>,
    action: ActionFor<K>,
  ): ResultAsync<void, AuthzError> {
    const refused: AuthzError = {
      type: "forbidden",
      kind: resource.kind,
      resourceId: resource.id,
      action,
    };

    return checkResource(principal, resource, [action]).andThen((decisions) =>
      decisions[action] ? okAsync(undefined) : errAsync(refused),
    );
  }

  return { checkResource, requireAction };
}

/**
 * Turns the PDP's effects into booleans, refusing anything ambiguous.
 *
 * An action the PDP did not answer is a protocol error rather than a DENY.
 * "Absent means deny" reads as the safe default and is not: it hides the
 * case where this client and the policy repo disagree about which actions
 * exist, which is precisely the drift `policy-drift.test.ts` exists to catch.
 * Only EFFECT_ALLOW is an allow; EFFECT_NO_MATCH (deny-by-default) and
 * EFFECT_DENY are both simply false.
 */
function parseDecisions<K extends ResourceKind>(
  payload: unknown,
  resource: Resource<K>,
  actions: readonly ActionFor<K>[],
): ResultAsync<ActionDecisions<K>, AuthzError> {
  const parsed = checkResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return errAsync({
      type: "pdp_protocol_error",
      cause: `unrecognised PDP response: ${parsed.error.message}`,
    });
  }

  const result = parsed.data.results.find(
    (candidate) =>
      candidate.resource.kind === resource.kind && candidate.resource.id === resource.id,
  );
  if (result === undefined) {
    return errAsync({
      type: "pdp_protocol_error",
      cause: `PDP answered about no resource matching ${resource.kind}/${resource.id}`,
    });
  }

  const decisions: Partial<Record<ActionFor<K>, boolean>> = {};
  for (const action of actions) {
    const effect = result.actions[action];
    if (effect === undefined) {
      return errAsync({
        type: "pdp_protocol_error",
        cause: `PDP did not answer for action "${action}" on ${resource.kind}/${resource.id}`,
      });
    }
    decisions[action] = effect === "EFFECT_ALLOW";
  }

  // Invariant: the loop above assigned every member of `actions` or returned
  // early, so `decisions` is total over the requested keys by construction.
  return okAsync(decisions as ActionDecisions<K>);
}
