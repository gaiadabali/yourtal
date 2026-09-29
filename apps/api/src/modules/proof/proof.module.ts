import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { ProofController } from "./proof.controller";

/**
 * 10.3.b: GET /api/proof/roots. Reuses WalletModule's own
 * `LEDGER_INTERNAL_CLIENT` rather than opening a second pool for one
 * read-only route, same reasoning CheckoutModule's own comment gives.
 */
@Module({
  imports: [WalletModule],
  controllers: [ProofController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class ProofModule {}
