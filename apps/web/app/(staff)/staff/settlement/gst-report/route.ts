import type { NextRequest } from "next/server";
import { proxyGstReport } from "@/features/staff/settlement/gst-report-proxy";

/** `/staff/settlement/gst-report?quarter=2026-Q4`: the quarterly GST report CSV download (6.12.a, finance). */
export async function GET(request: NextRequest) {
  return proxyGstReport(request.nextUrl.searchParams.get("quarter") ?? "");
}
