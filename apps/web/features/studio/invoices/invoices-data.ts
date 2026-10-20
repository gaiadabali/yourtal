import "server-only";

import { invoiceListSchema } from "@yourtal/contracts/invoice";
import type { InvoiceList } from "@yourtal/contracts/invoice";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * 5.3 / 14.9: Studio -> Invoices, against `GET /api/:tenantId/studio/invoices`.
 * Read-only and live only (an invoice exists once a purchase is paid, so there
 * is nothing to mock); the API scopes the list to the business in the path.
 */
export async function listInvoices(businessId: string): Promise<ApiResult<InvoiceList>> {
  return apiFetch(`/api/${businessId}/studio/invoices`, invoiceListSchema);
}
