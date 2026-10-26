import type { Region } from "@yourtal/contracts/region";
import { REGION_TIME_ZONE } from "@/features/region/region-time-zone";
import type { MerchantLocale } from "./merchant-device";

/**
 * One date or time for the counter, in its region's zone, never the server's
 * or the browser's: those differ, which React refuses to hydrate (#418), and
 * near midnight UTC they also name different days.
 */
export function formatMerchantTime(
  iso: string,
  locale: MerchantLocale,
  region: Region,
  kind: "time" | "dateTime" = "time",
): string {
  const timeZone = REGION_TIME_ZONE[region];
  const date = new Date(iso);
  return kind === "time"
    ? new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(date)
    : new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone }).format(
        date,
      );
}
