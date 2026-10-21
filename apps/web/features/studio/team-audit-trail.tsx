import { useContext } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { RegionContext } from "@/features/region/region-context";
import { describeAuditEntry } from "./studio-audit";
import type { TeamAuditEntry } from "./studio-audit";

// The business's own region zone (`StudioChrome` provides the region). Without a fixed zone the server and
// the browser format the same instant differently, and React refuses to hydrate the mismatch.
const TIME_ZONE = { AU: "Australia/Sydney", ID: "Asia/Jakarta" } as const;

export interface TeamAuditTrailProps {
  entries: readonly TeamAuditEntry[];
}

/** Plain-language audit log (docs/17 §2.1: "Every team action is audit-logged and visible to the business itself"). */
export function TeamAuditTrail({ entries }: TeamAuditTrailProps) {
  const t = useTranslations("studio");
  const format = useFormatter();
  const region = useContext(RegionContext);
  if (entries.length === 0) {
    return <p className="text-sm font-sans text-fg-muted">{t("team.audit.empty")}</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-b-0"
        >
          <span className="text-sm font-sans text-fg">{describeAuditEntry(entry, t)}</span>
          <time dateTime={entry.occurredAt} className="text-xs font-sans text-fg-subtle">
            {format.dateTime(new Date(entry.occurredAt), {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: region === null ? "UTC" : TIME_ZONE[region],
            })}
          </time>
        </li>
      ))}
    </ol>
  );
}
