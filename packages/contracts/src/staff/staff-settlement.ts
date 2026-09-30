import * as z from "zod";
import { regionSchema } from "../region/region";
import { statementSchema } from "../ledger-internal/economy";
import { economyProposalSchema } from "./staff-economy";

/**
 * TASKS.md 10.6.a: the staff console's settlement screens -- the queue of
 * open/disputed statements per region (from 10.1's `ledger.statementQueue`),
 * resolving a statement's own dispute (10.6.b raised it), and payout
 * approval. Payout approval reuses 9.5's `EconomyProposal` two-person
 * bookkeeping directly (`kind: "approve_payout"`, `staff-economy.ts`'s own
 * enum) rather than inventing a second proposal shape -- "propose" here
 * records intent only, exactly like 9.5.c's marketing funding; there is no
 * `ledger-internal` propose-payout call to make, only `approvePayout`
 * itself, which the SECOND approver's route calls.
 */

// -- the queue (10.6.a) -----------------------------------------------------

export const settlementQueueSchema = z
  .object({
    region: regionSchema,
    statements: z.array(statementSchema),
  })
  .strict();
export type SettlementQueue = z.infer<typeof settlementQueueSchema>;

// -- resolving a statement's own dispute (10.6.a; 10.6.b raised it) --------

export const resolveStatementDisputeBodySchema = z.object({
  note: z.string().min(1).max(500),
});
export type ResolveStatementDisputeBody = z.infer<typeof resolveStatementDisputeBodySchema>;

// -- payout approval, two-person (10.1.c/10.6.a) ----------------------------

export const proposePayoutBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type ProposePayoutBody = z.infer<typeof proposePayoutBodySchema>;

/** Same decision shape 9.5's own proposals use -- an optional note, nothing else. */
export const decideSettlementProposalBodySchema = z.object({
  note: z.string().min(1).max(500).optional(),
});
export type DecideSettlementProposalBody = z.infer<typeof decideSettlementProposalBodySchema>;

export const payoutProposalListSchema = z.array(economyProposalSchema);
