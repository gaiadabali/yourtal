import * as z from "zod";
import type { Region } from "../region/region";

/**
 * The viewer's own autoplay preference (TASKS.md 6.7.a): whether the next
 * item in a feed (6.3, not built yet) starts playing on its own. A closed
 * three-value enum, not a boolean, because "off" is not the only other
 * state a mobile viewer needs — data cost matters independently of whether
 * autoplay is wanted at all.
 */
export const autoplaySettingSchema = z.enum(["always", "wifi_only", "never"]);
export type AutoplaySetting = z.infer<typeof autoplaySettingSchema>;

/**
 * The default when no row has ever been written for this user. ID defaults
 * to `wifi_only` (TASKS.md 6.7.a: "Wi-Fi only by default in ID") — a
 * region-driven default because mobile data cost is a bigger fraction of a
 * reward's value in ID than in AU, so the platform should not spend it for
 * someone who never chose to. AU defaults to `always`, matching every other
 * mainstream feed's own default.
 */
export function defaultAutoplayFor(region: Region): AutoplaySetting {
  return region === "ID" ? "wifi_only" : "always";
}
