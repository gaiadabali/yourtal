import {
  charityPayoutsSchema,
  disbursementStatusSchema,
  payoutAccountSchema,
  payoutAccountStateSchema,
  payoutLinkSchema,
  staffDisbursementSchema,
  staffDisbursementsSchema,
  statementPayoutSchema,
  studioPayoutsSchema,
} from "../billing/payouts";
import type { ContractComponent } from "./schema-registry";

/** 5.2 (F103, F104): payouts in Australia on Stripe Connect. Its own file for the 300-line ceiling. */
export const PAYOUT_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "PayoutAccountState",
    schema: payoutAccountStateSchema,
    description: "A connected account: not set up, being set up or checked, or ready to be paid.",
    crossFieldRules: [],
  },
  {
    id: "DisbursementStatus",
    schema: disbursementStatusSchema,
    description:
      "An approved statement's payout: queued, waiting for the account, sent to the account (payout to the bank pending), paid to the bank, or failed.",
    crossFieldRules: [],
  },
  {
    id: "PayoutAccount",
    schema: payoutAccountSchema,
    description:
      "Where a brand or charity is paid. available is false outside Australia (F104). Only the bank's last four digits ever leave the server.",
    crossFieldRules: [],
  },
  {
    id: "StatementPayout",
    schema: statementPayoutSchema,
    description: "How one approved statement's payable is reaching the brand's bank.",
    crossFieldRules: [],
  },
  {
    id: "StudioPayouts",
    schema: studioPayoutsSchema,
    description:
      "Studio's payouts panel: the account, whether a payout failed or waits for the account, and each approved statement's payout.",
    crossFieldRules: [],
  },
  {
    id: "CharityPayouts",
    schema: charityPayoutsSchema,
    description: "A charity's connected account, where its auctions' proceeds are captured.",
    crossFieldRules: [],
  },
  {
    id: "PayoutLink",
    schema: payoutLinkSchema,
    description:
      "Where to send the browser: the processor's page to set up the account or change its bank, or straight back when nothing is asked.",
    crossFieldRules: [],
  },
  {
    id: "StaffDisbursement",
    schema: staffDisbursementSchema,
    description: "The staff settlement screen's view of one approved payout's transfer and payout.",
    crossFieldRules: [],
  },
  {
    id: "StaffDisbursements",
    schema: staffDisbursementsSchema,
    description: "A region's approved payouts and what became of each. Empty in Indonesia (F104).",
    crossFieldRules: [],
  },
];
