import { Button } from "@yourtal/ui/button";

export interface CampaignErrorPanelProps {
  title: string;
  description: string;
  onRetry: () => void;
}

/**
 * Shared recoverable-error presentation for both routes this feature owns
 * (`app/(app)/error.tsx` and `app/(app)/campaign/[campaignId]/error.tsx`).
 * Next.js requires `error.tsx` itself to be a client component, but the
 * presentation has no hooks of its own, so it stays a plain function and is
 * simply pulled into whichever client boundary renders it.
 *
 * Always renders a retry action — an error state that dead-ends the user is
 * exactly what the brief calls out as under-built ("error must be
 * recoverable").
 */
export function CampaignErrorPanel({ title, description, onRetry }: CampaignErrorPanelProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-danger/40 bg-surface px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      <Button onClick={onRetry}>Coba lagi</Button>
    </div>
  );
}
