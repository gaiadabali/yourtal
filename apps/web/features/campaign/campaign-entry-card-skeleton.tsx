import { Skeleton } from "@yourtal/ui/skeleton";
import { Card, CardContent } from "@yourtal/ui/card";
import { EntryCardFactSkeleton } from "./campaign-entry-fact";

/**
 * Loading placeholder for `CampaignEntryCard` (used by
 * `app/(app)/campaign/[campaignId]/loading.tsx`). Mirrors its section
 * structure — header, six fact rows, terms notice, primary action — using
 * `EntryCardFactSkeleton` for the facts so those six rows can't drift from
 * `EntryCardFact`'s real dimensions (campaign-entry-fact.tsx).
 */
export function CampaignEntryCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-10 w-full" />
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_unused, index) => (
            // Static placeholder list with no reordering or identity — index is a stable, appropriate key here.
            <EntryCardFactSkeleton key={index} />
          ))}
        </div>

        <Skeleton className="h-14 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}
