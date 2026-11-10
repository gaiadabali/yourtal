import "server-only";

import { apiInternalUrl } from "@/lib/api/env";
import { readSessionToken } from "@/lib/api/session-cookies";

const QUARTER = /^\d{4}-Q[1-4]$/;
const PASSED_HEADERS = ["content-type", "content-disposition"] as const;

/**
 * 6.12.a: streams the quarterly GST report CSV from the API to the browser. The
 * browser holds an httpOnly session cookie only this server may turn into the
 * API's bearer token, so the download goes through here. The API does the
 * authorising (finance only): its 401/403 pass through unchanged.
 */
export async function proxyGstReport(quarter: string): Promise<Response> {
  if (!QUARTER.test(quarter)) return new Response(null, { status: 400 });
  const token = await readSessionToken();
  if (token === null) return new Response(null, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiInternalUrl()}/api/staff/invoices/gst-report?quarter=${encodeURIComponent(quarter)}`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new Response(null, {
      status: [400, 401, 403].includes(upstream.status) ? upstream.status : 502,
    });
  }
  const headers = new Headers({ "cache-control": "private, no-store" });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
