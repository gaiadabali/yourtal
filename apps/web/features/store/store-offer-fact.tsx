import { Skeleton } from "@yourtal/ui/skeleton";
import { cn } from "@yourtal/ui/cn";

/**
 * One labelled fact row on the offer detail page (e.g. "Kategori" /
 * "Retail"), and its loading placeholder. Mirrors
 * `campaign-entry-fact.tsx`'s fixed label/value row heights so the
 * skeleton can never drift from the real row — kept as its own component
 * rather than a cross-feature import for the same reason as
 * `store-error-panel.tsx`.
 */
const LABEL_ROW_CLASS = "h-4";
const VALUE_ROW_CLASS = "h-5";

export interface StoreOfferFactProps {
  label: string;
  value: string;
  valueClassName?: string;
}

export function StoreOfferFact({ label, value, valueClassName }: StoreOfferFactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={cn(LABEL_ROW_CLASS, "text-xs text-fg-subtle")}>{label}</dt>
      <dd className={cn(VALUE_ROW_CLASS, "text-sm font-medium text-fg", valueClassName)}>{value}</dd>
    </div>
  );
}

export function StoreOfferFactSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <Skeleton className={cn(LABEL_ROW_CLASS, "w-16")} />
      <Skeleton className={cn(VALUE_ROW_CLASS, "w-24")} />
    </div>
  );
}
