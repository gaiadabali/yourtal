import "server-only";

import { apiInternalUrl } from "@/lib/api/env";
import { readSessionToken } from "@/lib/api/session-cookies";
import { LEAD_STATUSES } from "./spambank-staff-contract";
import { leadQueryString } from "./spambank-staff-data";

/**
 * Streams `GET /api/staff/spambank/leads/export.csv` to the browser. The
 * session cookie is httpOnly and only this server may turn it into the API's
 * bearer token, so the download goes through here (same shape as the invoice
 * PDF proxy). The API does the authorising and the region scoping; its 401 and
 * 403 pass through. Only the two filters the list page offers are forwarded.
 */
export async function proxyLeadsCsv(searchParams: URLSearchParams): Promise<Response> {
  const token = await readSessionToken();
  if (token === null) return new Response(null, { status: 401 });

  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";
  const query = leadQueryString({
    ...((LEAD_STATUSES as readonly string[]).includes(status)
      ? { status: status as (typeof LEAD_STATUSES)[number] }
      : {}),
    ...(q === "" ? {} : { q: q.slice(0, 200) }),
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${apiInternalUrl()}/api/staff/spambank/leads/export.csv${query}`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/csv" },
      cache: "no-store",
    });
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new Response(null, {
      status: [401, 403, 404].includes(upstream.status) ? upstream.status : 502,
    });
  }
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "text/csv; charset=utf-8",
    "content-disposition":
      upstream.headers.get("content-disposition") ?? 'attachment; filename="spambank-leads.csv"',
  });
  return new Response(upstream.body, { status: 200, headers });
}
