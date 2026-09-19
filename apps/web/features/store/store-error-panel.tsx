import { Button } from "@yourtal/ui/button";

export interface StoreErrorPanelProps {
  title: string;
  description: string;
  onRetry: () => void;
}

/**
 * Recoverable-error presentation for `app/(app)/store/error.tsx` and
 * `app/(app)/store/[listingId]/error.tsx`. Mirrors
 * `campaign-error-panel.tsx`'s shape; kept as its own small component
 * rather than a cross-feature import so this feature does not depend on a
 * sibling feature owned by a different in-flight ticket.
 *
 * Always renders a retry action — an error state that dead-ends the user is
 * exactly what the brief calls out as under-built.
 */
export function StoreErrorPanel({ title, description, onRetry }: StoreErrorPanelProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-danger/40 bg-surface px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      <Button onClick={onRetry}>Coba lagi</Button>
    </div>
  );
}
