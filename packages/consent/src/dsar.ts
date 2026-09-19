import { z } from "zod";

/**
 * Withdrawal, subject-access and deletion orchestration. YT-0036 AC3, which
 * asks for this **stubbed with owners named** — so this file is a map of who
 * must act and what the correct action is, not an implementation.
 *
 * ## The thing that makes this hard, stated once
 *
 * **"Delete everything" is the wrong instruction and would break the
 * platform.** `docs/14` §8 makes the audit log append-only and hash-chained
 * with a daily Merkle root published to a write-once bucket, and `docs/18`
 * makes the ledger append-only with a DB-enforced balance constraint. Erase
 * a row from either and the chain no longer verifies — which destroys the
 * evidence that every other balance is correct, for every other user.
 *
 * There is also law pulling the other way: tax and AML retention, and
 * `docs/03` §2 on records a regulator can require. A subject's right to
 * erasure does not extend to records held under a separate legal obligation.
 *
 * So deletion here is **per-domain and typed**: `erase` where we simply hold
 * data, `anonymise` where the record must survive but the person need not be
 * identifiable in it, and `retain` where law requires keeping it and the
 * basis has to be named. A single boolean "deleted" flag cannot express any
 * of that, and the implementation that assumes it will either break the
 * ledger or fail the DSAR.
 *
 * ## Withdrawal is not deletion
 *
 * Withdrawing consent stops future processing for that purpose. It does not
 * by itself erase what was already lawfully processed, and it must not
 * silently do so — a user who toggles off interest targeting has not asked
 * to lose their voucher history. They are separate operations with separate
 * consequences, which is why `withdrawalEffects` and `deletionPlan` are two
 * functions.
 */

/**
 * Who is accountable, by the internal roles in `docs/17` §5. A named role
 * rather than a person: people leave, and an unowned deletion step is one
 * that silently does not happen.
 */
export const dataOwnerRoleSchema = z.enum(["ops", "finance", "risk_analyst", "support", "admin"]);
export type DataOwnerRole = z.infer<typeof dataOwnerRoleSchema>;

export const deletionActionSchema = z.enum([
  /** Remove the data. Safe where nothing depends on its integrity. */
  "erase",
  /**
   * Keep the record, sever the person. Required wherever an append-only
   * chain or a balance invariant depends on the row continuing to exist.
   */
  "anonymise",
  /** Keep it, identified, under a legal obligation that outranks erasure. */
  "retain",
]);
export type DeletionAction = z.infer<typeof deletionActionSchema>;

export const dataDomainSchema = z
  .object({
    id: z.string().min(1),
    /** What personal data lives here, in plain terms. */
    holds: z.string().min(1),
    /** The service that owns the store. */
    service: z.string().min(1),
    owner: dataOwnerRoleSchema,
    onDeletion: deletionActionSchema,
    /**
     * Required whenever `onDeletion` is not `erase`. An exception to the
     * right to erasure that cannot state its basis is not an exception —
     * `dsar.test.ts` fails the build if one is missing.
     */
    basis: z.string().min(1).optional(),
  })
  .strict()
  .refine((domain) => domain.onDeletion === "erase" || domain.basis !== undefined, {
    message: "a domain that is not erased must name the basis for keeping it",
    path: ["basis"],
  });

export type DataDomain = z.infer<typeof dataDomainSchema>;

const DOMAINS: readonly DataDomain[] = [
  {
    id: "identity",
    holds: "Phone number, name, language, jurisdiction",
    service: "YourtalID (Zitadel)",
    owner: "ops",
    onDeletion: "erase",
  },
  {
    id: "consent_records",
    holds: "Which purposes were agreed to, when, at which policy version",
    service: "consent",
    owner: "ops",
    onDeletion: "retain",
    basis:
      "Evidence of the lawful basis relied on while processing. Erasing it would remove the proof that past processing was lawful, which is the opposite of what the subject's own complaint would need.",
  },
  {
    id: "ledger",
    holds: "Points earned, burned, expired, adjusted",
    service: "ledger",
    owner: "finance",
    onDeletion: "anonymise",
    basis:
      "Append-only and hash-chained with a published daily Merkle root (docs/14 §8, docs/18). Deleting an entry breaks the chain and invalidates the proof for every other user's balance. The subject is severed from the entries instead.",
  },
  {
    id: "vouchers",
    holds: "Issued codes, redemption events, which merchant honoured them",
    service: "voucher",
    owner: "finance",
    onDeletion: "anonymise",
    basis:
      "A merchant is owed settlement for a redemption that happened. The event must survive; the person attached to it need not.",
  },
  {
    id: "watch_sessions",
    holds: "Which campaigns were watched, checkpoint answers, drop-off points",
    service: "watch",
    owner: "ops",
    onDeletion: "erase",
  },
  {
    id: "research_answers",
    holds: "Answers sold to a panel buyer",
    service: "watch",
    owner: "ops",
    onDeletion: "anonymise",
    basis:
      "Already delivered to a buyer as part of an aggregate. Withdrawal stops future inclusion; it cannot recall a cohort statistic already published.",
  },
  {
    id: "risk_signals",
    holds: "Device fingerprints, IP history, cluster membership, trust tier",
    service: "risk",
    owner: "risk_analyst",
    onDeletion: "retain",
    basis:
      "Fraud prevention (docs/14 §3). Erasing the signals of a farmed account on request would make deletion the last step of the attack.",
  },
  {
    id: "support_cases",
    holds: "Case notes, goodwill credits, correspondence",
    service: "support",
    owner: "support",
    onDeletion: "anonymise",
    basis: "Dispute history and the audit of who granted what must survive the subject.",
  },
  {
    id: "tax_records",
    holds: "Settlement and withholding records naming the subject",
    service: "finance",
    owner: "finance",
    onDeletion: "retain",
    basis:
      "Statutory retention. YT-0016 is still resolving the Indonesian marketplace withholding position; until it does, assume retention is required and revisit.",
  },
];

/** Every data domain a DSAR or deletion must account for. */
export const DATA_DOMAINS: readonly DataDomain[] = DOMAINS.map((domain) =>
  dataDomainSchema.parse(domain),
);

/**
 * What a deletion request resolves to, per domain. Every domain appears —
 * an omitted domain is a domain nobody deleted, and the whole point of
 * enumerating them is that silence is not an answer.
 *
 * NOT IMPLEMENTED: each domain's actual handler. This returns the plan and
 * names the owner; executing it is per-service work that lands with each
 * service. `dsar.test.ts` asserts the plan is total and that every
 * non-erasure names a basis.
 */
export function deletionPlan(): readonly DataDomain[] {
  return DATA_DOMAINS;
}

/**
 * What withdrawing consent does, as distinct from deletion: processing for
 * that purpose stops. Nothing is erased, because nothing was unlawful — it
 * was lawful when it happened and the record of it stays.
 *
 * Returned as prose rather than a handler for the same reason as above: the
 * orchestration is a stub, the boundary is not.
 */
export function withdrawalEffects(purpose: string): {
  readonly stopsProcessingFor: string;
  readonly erases: false;
  readonly note: string;
} {
  return {
    stopsProcessingFor: purpose,
    erases: false,
    note:
      "Withdrawal is forward-looking. It does not erase what was lawfully processed under the " +
      "consent while it stood, and it must not silently trigger deletion — a user switching off " +
      "interest targeting has not asked to lose their voucher history. To erase, they make a " +
      "deletion request, which resolves through deletionPlan().",
  };
}
