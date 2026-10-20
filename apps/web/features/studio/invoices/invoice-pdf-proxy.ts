import "server-only";

import { apiInternalUrl } from "@/lib/api/env";
import { readSessionToken } from "@/lib/api/session-cookies";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the API's PDF response says about the file; nothing else is passed on. */
const PASSED_HEADERS = ["content-type", "content-disposition"] as const;

/**
 * Streams an invoice PDF from the API to the browser. The browser holds an
 * httpOnly session cookie that only this server may turn into the API's bearer
 * token, so the download goes through here rather than straight to the API
 * (nginx forwards `/api/` in staging, but `next dev` has no nginx). The API
 * does the authorising: another business's invoice is its 404, another
 * tenant its 403, and both pass through unchanged.
 */
export async function proxyInvoicePdf(businessId: string, invoiceId: string): Promise<Response> {
  if (!UUID.test(businessId) || !UUID.test(invoiceId)) return new Response(null, { status: 404 });
  const token = await readSessionToken();
  if (token === null) return new Response(null, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiInternalUrl()}/api/${businessId}/studio/invoices/${invoiceId}/pdf`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new Response(null, {
      status: [401, 403, 404].includes(upstream.status) ? upstream.status : 502,
    });
  }
  const headers = new Headers({ "cache-control": "private, no-store" });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
