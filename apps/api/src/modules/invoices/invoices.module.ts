import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { createPool } from "../../shared/persistence/create-pool";
import { INVOICE_ISSUER, InvoiceIssuer } from "./invoice-issuer";
import { INVOICE_REPOSITORY, INVOICES_DB_POOL, InvoiceRepository } from "./invoice.repository";
import { StaffInvoicesController } from "./staff-invoices.controller";
import { StudioInvoicesController } from "./studio-invoices.controller";

class InvoicesPoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(INVOICES_DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * 5.3 / 14.9: GST tax invoices. Issuing is `InvoiceIssuer` (the worker's
 * `invoice-issue` job runs the same code on a schedule); this module serves
 * the list and the PDF to a business in Studio and to staff.
 */
@Module({
  controllers: [StudioInvoicesController, StaffInvoicesController],
  providers: [
    {
      provide: INVOICES_DB_POOL,
      useFactory: (config: AppConfig): Pool => createPool(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: INVOICE_REPOSITORY,
      useFactory: (pool: Pool) => new InvoiceRepository(pool),
      inject: [INVOICES_DB_POOL],
    },
    {
      provide: INVOICE_ISSUER,
      useFactory: (pool: Pool) => new InvoiceIssuer(pool),
      inject: [INVOICES_DB_POOL],
    },
    InvoicesPoolShutdown,
  ],
  exports: [INVOICE_ISSUER, INVOICE_REPOSITORY],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class InvoicesModule {}
