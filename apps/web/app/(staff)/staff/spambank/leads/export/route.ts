import type { NextRequest } from "next/server";
import { proxyLeadsCsv } from "@/features/staff/spambank/spambank-leads-export";

/** `/staff/spambank/leads/export?status=&q=`: the lead list as a CSV download for GOD's sales team. */
export async function GET(request: NextRequest) {
  return proxyLeadsCsv(request.nextUrl.searchParams);
}
