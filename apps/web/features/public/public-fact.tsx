export interface PublicFactProps {
  label: string;
  value: string;
  valueClassName?: string;
}

/**
 * One labelled fact row (e.g. "Durasi" / "18 menit") for the public
 * campaign/offer pages. Deliberately its own small component rather than a
 * cross-feature import of `campaign-entry-fact.tsx`/`store-offer-fact.tsx`
 * — this codebase's established pattern for this exact atom (see
 * `store-offer-fact.tsx`'s own doc comment) — and simpler than either: a
 * static public page has no loading state, so there is no skeleton variant
 * to keep in lockstep with.
 */
export function PublicFact({ label, value, valueClassName = "" }: PublicFactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={`text-sm font-medium text-fg ${valueClassName}`.trim()}>{value}</dd>
    </div>
  );
}
