import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { InvoiceList } from "@yourtal/contracts/invoice";
import { buildGstReportCsv, parseGstPeriod } from "@yourtal/db/invoicing/gst-report";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { invoiceListQuerySchema } from "./invoice-list-query";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { renderInvoicePdf } from "./invoice-pdf";
import { INVOICE_REPOSITORY, InvoiceRepository } from "./invoice.repository";
import { sendInvoicePdf } from "./send-invoice-pdf";

/**
 * 5.3 / 14.9: staff read any business's invoices, in any region, like the
 * settlement queue next door: `billing` `view_statement_queue` (finance and
 * ops, never a business role), audited per call. Staff routes are never
 * tenant-scoped.
 */
@Controller("api/staff/invoices")
export class StaffInvoicesController {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Authorize({
    kind: "billing",
    action: "view_statement_queue",
    attrsFrom: () => ({ businessId: "staff" }),
  })
  @StaffAction("invoices.list")
  @NotValueMoving("A read.")
  @Get()
  async list(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
  ): Promise<InvoiceList> {
    const parsed = invoiceListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_query", message: parsed.error.message });
    }
    setStaffAuditContext(request, {
      targetKind: "invoice_list",
      targetId: parsed.data.businessId ?? parsed.data.region ?? "all",
      ...(parsed.data.region === undefined ? {} : { region: parsed.data.region }),
    });
    return { invoices: await this.invoices.listForStaff(parsed.data) };
  }

  /**
   * 6.12.a: the quarterly GST report as a CSV (`?quarter=2026-Q4`, or `from` and
   * `to`). Finance only (`billing` `export_gst_report`); every download is audited.
   */
  @Authorize({
    kind: "billing",
    action: "export_gst_report",
    attrsFrom: () => ({ businessId: "staff", region: "AU" }),
  })
  @StaffAction("invoices.gst_report")
  @NotValueMoving("A read.")
  @Get("gst-report")
  async gstReport(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const text = (value: string | string[] | undefined): string | undefined =>
      typeof value === "string" ? value : undefined;
    const period = parseGstPeriod({
      quarter: text(query["quarter"]),
      from: text(query["from"]),
      to: text(query["to"]),
    });
    if (period === null) {
      throw new BadRequestException({
        code: "invalid_period",
        message:
          "Give quarter=YYYY-Q1..Q4, or from and to as YYYY-MM-DD (from not after to, under a year).",
      });
    }
    const rows = await this.invoices.gstReportRows(period);
    setStaffAuditContext(request, {
      targetKind: "gst_report",
      targetId: period.label,
      region: "AU",
      detail: { from: period.from, to: period.to, rows: rows.length },
    });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="gst-report-${period.label}.csv"`);
    reply.header("cache-control", "private, no-store");
    return buildGstReportCsv(period, rows);
  }

  @Authorize({
    kind: "billing",
    action: "view_statement_queue",
    attrsFrom: () => ({ businessId: "staff" }),
  })
  @StaffAction("invoices.download")
  @NotValueMoving("A read.")
  @Get(":invoiceId/pdf")
  async pdf(
    @Param("invoiceId", new ParseUUIDPipe()) invoiceId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const invoice = await this.invoices.findForStaff(invoiceId);
    if (invoice === null) {
      throw new NotFoundException({ code: "invoice_not_found", message: "no such invoice" });
    }
    setStaffAuditContext(request, {
      targetKind: "invoice",
      targetId: invoice.id,
      region: invoice.region,
      detail: { number: invoice.number, businessId: invoice.businessId },
    });
    return sendInvoicePdf(
      reply,
      invoice,
      await renderInvoicePdf(invoice, { demo: this.config.appEnv !== "production" }),
    );
  }
}
