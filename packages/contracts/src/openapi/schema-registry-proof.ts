import { provedDaySchema } from "../ledger-internal/proof";
import type { ContractComponent } from "./schema-registry";

/**
 * 10.3.b's one public route: GET /api/proof/roots. `provedDaySchema` lives
 * in `ledger-internal/` because services/ledger is where it is computed,
 * but unlike the rest of that folder it IS this route's own public
 * response shape verbatim (F11: anyone can verify a day's root later), so
 * it is registered here rather than exempted as an internal
 * service-to-service type.
 */
export const PROOF_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "ProvedDay",
    schema: provedDaySchema,
    description:
      "One day's Merkle root over that day's ledger entries and voucher chain heads (4.6.h) -- recomputable by anyone from their own copy of that day's data, without a blockchain.",
    crossFieldRules: [],
  },
];
