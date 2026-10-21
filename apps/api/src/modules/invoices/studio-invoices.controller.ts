import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { InvoiceList } from "@yourtal/contracts/invoice";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { renderInvoicePdf } from "./invoice-pdf";
import { INVOICE_REPOSITORY, InvoiceRepository } from "./invoice.repository";
import { sendInvoicePdf } from "./send-invoice-pdf";

/**
 * 5.3 / 14.9: a business's own tax invoices. Same authorisation as the other
 * Studio billing reads (`billing` `view`: owner, admin, finance), and every
 * query carries the tenant id, so another business's invoice looks exactly
 * like a missing one.
 */
@Controller("api/:tenantId/studio/invoices")
export class StudioInvoicesController {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Param("tenantId", new ParseUUIDPipe()) tenantId: string): Promise<InvoiceList> {
    return { invoices: await this.invoices.listForBusiness(tenantId) };
  }

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A read.")
  @Get(":invoiceId/pdf")
  async pdf(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Param("invoiceId", new ParseUUIDPipe()) invoiceId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const invoice = await this.invoices.findForBusiness(tenantId, invoiceId);
    if (invoice === null) {
      throw new NotFoundException({ code: "invoice_not_found", message: "no such invoice" });
    }
    return sendInvoicePdf(
      reply,
      invoice,
      await renderInvoicePdf(invoice, { demo: this.config.appEnv !== "production" }),
    );
  }
}
