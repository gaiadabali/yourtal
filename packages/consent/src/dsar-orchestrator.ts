import { DATA_DOMAINS } from "./dsar";
import type { DataDomain, DeletionAction } from "./dsar";

/**
 * Executes a deletion request across every data domain. YT-0036 AC3.
 *
 * `dsar.ts` names what must happen to each domain and who owns it. This runs
 * it — and the single most important thing it does is **refuse to report
 * success for a domain nobody implemented.**
 *
 * ## Why that is the whole design
 *
 * A subject asks to be deleted. Nine services must act. The tempting
 * implementation loops over the handlers it has, succeeds, and reports done —
 * and the three domains with no handler are silently skipped. The subject is
 * told they were erased, the regulator is told they were erased, and their
 * data is still in two of the nine places. Nobody finds out until someone
 * looks, which for a deletion request is usually a complaint.
 *
 * That is the same failure as a test suite that skips: **a run that did less
 * than it claims, reporting the same result as one that did everything.** So
 * an unhandled domain is a FAILED request here, not an omitted line.
 */

/** What actually happened to one domain. */
export type DomainOutcome =
  | { readonly status: "erased"; readonly records: number }
  | { readonly status: "anonymised"; readonly records: number }
  /** Kept under a legal basis. The basis is carried so the audit can read it. */
  | { readonly status: "retained"; readonly basis: string }
  /**
   * No handler. The request as a whole fails: see the header. Carries the
   * owner so the failure names who has to write it.
   */
  | { readonly status: "unhandled"; readonly owner: string }
  /** A handler ran and failed. Distinct from unhandled — one is a missing
   * implementation, the other a broken one, and they need different people. */
  | { readonly status: "failed"; readonly reason: string };

export interface DomainResult {
  readonly domain: string;
  readonly outcome: DomainOutcome;
}

export interface DeletionReport {
  readonly subjectId: string;
  readonly complete: boolean;
  readonly results: readonly DomainResult[];
}

/**
 * Executes one domain's part of a deletion.
 *
 * Returns the count of records affected. Throwing is fine — the orchestrator
 * records it as `failed` rather than letting it abort the whole run, because
 * one broken service must not stop the other eight from erasing what they
 * hold.
 */
export type DomainHandler = (subjectId: string) => Promise<number>;

/** Handlers by domain id. A domain with no entry is unhandled, not skipped. */
export type HandlerRegistry = Readonly<Record<string, DomainHandler>>;

/**
 * Runs a deletion request across every domain in `DATA_DOMAINS`.
 *
 * `complete` is true only when every domain reached a terminal state that
 * actually accounts for the subject's data: erased, anonymised, or retained
 * under a stated basis. One `unhandled` or `failed` makes the whole request
 * incomplete, and the report says which.
 */
export async function executeDeletion(
  subjectId: string,
  handlers: HandlerRegistry,
  domains: readonly DataDomain[] = DATA_DOMAINS,
): Promise<DeletionReport> {
  const results: DomainResult[] = [];

  for (const domain of domains) {
    results.push({ domain: domain.id, outcome: await runOne(subjectId, domain, handlers) });
  }

  return {
    subjectId,
    complete: results.every(({ outcome }) => isAccountedFor(outcome.status)),
    results,
  };
}

async function runOne(
  subjectId: string,
  domain: DataDomain,
  handlers: HandlerRegistry,
): Promise<DomainOutcome> {
  // A retained domain needs no handler — the correct action is to do
  // nothing, deliberately, and say why. `dsar.ts`'s schema already refuses a
  // retention with no basis, so this cannot report an unexplained one.
  if (domain.onDeletion === "retain") {
    return { status: "retained", basis: domain.basis ?? "unstated" };
  }

  const handler = handlers[domain.id];
  if (handler === undefined) {
    return { status: "unhandled", owner: domain.owner };
  }

  try {
    const records = await handler(subjectId);
    return { status: statusFor(domain.onDeletion), records };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

function statusFor(action: DeletionAction): "erased" | "anonymised" {
  return action === "erase" ? "erased" : "anonymised";
}

function isAccountedFor(status: DomainOutcome["status"]): boolean {
  return status === "erased" || status === "anonymised" || status === "retained";
}

/**
 * The domains still waiting for a handler, so the gap is a number somebody
 * can watch rather than something discovered during a request.
 *
 * Deliberately a query rather than a test fixture: the honest answer today
 * is "most of them", and that should be visible on a dashboard rather than
 * asserted away.
 */
export function unhandledDomains(
  handlers: HandlerRegistry,
  domains: readonly DataDomain[] = DATA_DOMAINS,
): readonly DataDomain[] {
  return domains.filter(
    (domain) => domain.onDeletion !== "retain" && handlers[domain.id] === undefined,
  );
}
