import { Skeleton } from "@yourtal/ui/skeleton";
import { cn } from "@yourtal/ui/cn";

/**
 * One labelled fact row on the entry card (e.g. "Durasi" / "18 menit"), and
 * its loading placeholder. Both share the same fixed label/value height
 * classes for the same reason `CampaignCardLayout` does on the board
 * (campaign-card-layout.tsx) — one shared shape, so the skeleton cannot
 * drift from the real row.
 */
const LABEL_ROW_CLASS = "h-4";
const VALUE_ROW_CLASS = "h-5";

export interface EntryCardFactProps {
  label: string;
  value: string;
  valueClassName?: string;
}

export function EntryCardFact({ label, value, valueClassName }: EntryCardFactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={cn(LABEL_ROW_CLASS, "text-xs text-fg-subtle")}>{label}</dt>
      <dd className={cn(VALUE_ROW_CLASS, "text-sm font-medium text-fg", valueClassName)}>{value}</dd>
    </div>
  );
}

export function EntryCardFactSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <Skeleton className={cn(LABEL_ROW_CLASS, "w-16")} />
      <Skeleton className={cn(VALUE_ROW_CLASS, "w-24")} />
    </div>
  );
}
