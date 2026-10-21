import { useFormatter } from "next-intl";

type Formatter = ReturnType<typeof useFormatter>;

/** A fixed zone per region: without one the server formats in its own zone and the browser in the visitor's, and React refuses to hydrate the mismatch (#418). */
export const STAFF_TIME_ZONE = { AU: "Australia/Sydney", ID: "Asia/Jakarta" } as const;

export type StaffTimeKind = "dateTime" | "date";

/**
 * One date for a staff screen, in the row's region zone. A row with no region
 * (an erased user, a request with no region on it) is shown in UTC, and a time
 * says so, so nobody reads it as local.
 */
export function formatStaffTime(
  format: Formatter,
  iso: string,
  region: keyof typeof STAFF_TIME_ZONE | null | undefined,
  kind: StaffTimeKind = "dateTime",
): string {
  const timeZone = region === null || region === undefined ? "UTC" : STAFF_TIME_ZONE[region];
  const date = new Date(iso);
  if (kind === "date") return format.dateTime(date, { dateStyle: "medium", timeZone });
  if (region === null || region === undefined) {
    // `dateStyle`/`timeStyle` cannot be combined with a zone name, so spell the same shape out.
    return format.dateTime(date, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
  }
  return format.dateTime(date, { dateStyle: "medium", timeStyle: "short", timeZone });
}

/** `formatStaffTime` bound to the viewer's next-intl formatter. */
export function useStaffTime(): (
  iso: string,
  region: keyof typeof STAFF_TIME_ZONE | null | undefined,
  kind?: StaffTimeKind,
) => string {
  const format = useFormatter();
  return (iso, region, kind) => formatStaffTime(format, iso, region, kind);
}
