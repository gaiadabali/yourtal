import type { NextRequest } from "next/server";
import { proxyInvoicePdf } from "@/features/studio/invoices/invoice-pdf-proxy";

/** `/studio/billing/invoices/:invoiceId/pdf?business=<id>`: one invoice as a PDF download (5.3). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await context.params;
  const businessId = request.nextUrl.searchParams.get("business") ?? "";
  return proxyInvoicePdf(businessId, invoiceId);
}
