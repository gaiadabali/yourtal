import type { Region } from "@yourtal/contracts/region";

/**
 * One fixed IANA zone per region. A date formatted without one renders in the
 * server's zone on the server and the visitor's in the browser, so React
 * refuses to hydrate the mismatch (#418) and a time near midnight UTC can show
 * the wrong day. Type-only import: no Zod reaches the initial bundle.
 */
export const REGION_TIME_ZONE: Record<Region, string> = {
  AU: "Australia/Sydney",
  ID: "Asia/Jakarta",
};
