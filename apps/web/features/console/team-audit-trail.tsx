import type { TeamAuditEntry } from "./console-audit";

export interface TeamAuditTrailProps {
  entries: readonly TeamAuditEntry[];
}

/** Plain-language audit log (docs/17 §2.1: "Every team action is audit-logged and visible to the business itself"). */
export function TeamAuditTrail({ entries }: TeamAuditTrailProps) {
  if (entries.length === 0) {
    return <p className="text-sm font-sans text-fg-muted">No team actions recorded yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-b-0"
        >
          <span className="text-sm font-sans text-fg">{entry.description}</span>
          <time dateTime={entry.occurredAt} className="text-xs font-sans text-fg-subtle">
            {new Date(entry.occurredAt).toLocaleString("en-AU", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </li>
      ))}
    </ol>
  );
}
