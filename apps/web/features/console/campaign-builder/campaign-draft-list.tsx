import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { draftDurationSeconds } from "./campaign-draft";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftStatusBadge } from "./campaign-draft-status-badge";

export interface CampaignDraftListProps {
  drafts: readonly CampaignDraft[];
  onOpen: (draftId: string) => void;
  onCreate: () => void;
  canEdit: boolean;
}

function formatMinutes(durationSeconds: number): string {
  const minutes = Math.round(durationSeconds / 60);
  return minutes <= 0 ? "no video yet" : `${minutes} min`;
}

/** The campaign list: one row per draft, its workflow status and — for a rejected one — the reason right there, not hidden behind a click. No local state, rendered inside `campaign-builder-screen.tsx`'s client tree. */
export function CampaignDraftList({ drafts, onOpen, onCreate, canEdit }: CampaignDraftListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-sans font-semibold text-fg">Campaigns</h2>
        {canEdit ? (
          <Button type="button" onClick={onCreate}>
            New campaign
          </Button>
        ) : null}
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-sans text-fg-muted">No campaigns yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => onOpen(draft.id)}
                    className="flex flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-sans font-semibold text-fg">
                        {draft.title || "Untitled campaign"}
                      </span>
                      <CampaignDraftStatusBadge status={draft.status} />
                    </div>
                    <p className="text-xs font-sans text-fg-muted">
                      {formatMinutes(draftDurationSeconds(draft))} · {draft.rewardPoints} points
                    </p>
                  </button>
                  {draft.status === "rejected" && draft.rejectionReason ? (
                    <div className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2">
                      <Badge variant="danger" className="shrink-0">
                        Rejected
                      </Badge>
                      <p className="text-xs font-sans text-fg-muted">{draft.rejectionReason}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
