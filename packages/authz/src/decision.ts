import type { ActionFor, ResourceKind } from "./resources";

/**
 * What a decision can be, and what a failure to reach one must never be.
 *
 * docs/14 section 8 (A10, Mishandling Exceptional Conditions) is categorical:
 * **value operations fail closed** — a KMS, Cerbos or ledger timeout must
 * never fall through to "grant" or "approve". So there is no boolean here.
 * A caller cannot write `if (await allowed(...))` and quietly treat an
 * unreachable PDP as permission, because the unreachable case is not `false`,
 * it is an `Err` they are made to handle. `neverthrow/must-use-result` (ESLint,
 * docs/13b section 4) turns forgetting to handle it into a build failure.
 */

/**
 * Expected authorization failures, as a discriminated union on `type` —
 * never a bare string and never an `Error` (docs/13b section 4). Exactly one
 * adapter per app maps these to an HTTP status and an error envelope code;
 * a controller never builds that body itself.
 */
export type AuthzError =
  /**
   * The PDP said no. This is a normal, expected outcome and carries the
   * subject of the decision so the audit log can record what was refused
   * without the caller re-deriving it.
   */
  | {
      readonly type: "forbidden";
      readonly kind: ResourceKind;
      readonly resourceId: string;
      readonly action: string;
    }
  /**
   * The PDP could not be reached, or did not answer in time. NOT a DENY and
   * NOT an ALLOW: a distinct outcome, because the two need different
   * responses — a 403 teaches a user something, a 503 pages someone.
   */
  | { readonly type: "pdp_unavailable"; readonly cause: string }
  /**
   * The PDP answered with something this client cannot parse, or omitted a
   * requested action from its response. Treated as a hard failure rather
   * than an absent-means-deny convenience: a shape we do not recognise means
   * the two sides disagree about the contract, and guessing is how a DENY
   * silently becomes an ALLOW after an upgrade.
   */
  | { readonly type: "pdp_protocol_error"; readonly cause: string };

/** One resource's answers, keyed by the actions that were asked about. */
export type ActionDecisions<K extends ResourceKind> = Readonly<Record<ActionFor<K>, boolean>>;

/** Renders an `AuthzError` for a log line. Never shown to an end user. */
export function describeAuthzError(error: AuthzError): string {
  switch (error.type) {
    case "forbidden":
      return `forbidden: ${error.action} on ${error.kind}/${error.resourceId}`;
    case "pdp_unavailable":
      return `pdp unavailable: ${error.cause}`;
    case "pdp_protocol_error":
      return `pdp protocol error: ${error.cause}`;
    default: {
      // Adding a variant must break every consumer at compile time — that is
      // the intent of the `never` default (docs/13b section 4).
      const unreachable: never = error;
      return String(unreachable);
    }
  }
}
