import { Controller, Get, Inject, InternalServerErrorException } from "@nestjs/common";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";

/**
 * 10.3.b: `GET /api/proof/roots` republishes services/ledger's own daily
 * proof roots verbatim (F11: "generation, redemption and a client SDK,
 * secure and tamper-evident … with the root published", no blockchain).
 * B's `/[locale]/transparency` (11.3) lists these so anyone can recompute a
 * day's root from their own copy of that day's entries and compare.
 */
@Controller("api/proof")
export class ProofController {
  constructor(@Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient) {}

  @PublicRoute(
    "F11: the whole point is that anyone, signed in or not, can verify a " +
      "day's root later. It carries no secret and moves nothing.",
  )
  @Get("roots")
  async roots() {
    const result = await this.ledger.proofRoots();
    if (result.isErr()) {
      throw new InternalServerErrorException({
        code: result.error.code,
        message: result.error.message,
      });
    }
    return { roots: result.value };
  }
}
