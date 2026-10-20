import type { FastifyReply } from "fastify";
import type { Invoice } from "@yourtal/contracts/invoice";

/** A download, never shown inline, and never cached by a shared proxy. */
export function sendInvoicePdf(reply: FastifyReply, invoice: Invoice, pdf: Buffer): Buffer {
  reply.header("content-type", "application/pdf");
  reply.header("content-disposition", `attachment; filename="${invoice.number}.pdf"`);
  reply.header("cache-control", "private, no-store");
  return pdf;
}
