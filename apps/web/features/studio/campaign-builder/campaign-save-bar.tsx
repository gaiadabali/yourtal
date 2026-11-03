"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";

/** Where the Details and Targeting fields stand against what the server holds. */
export type DetailsSaveState =
  { status: "saved" | "dirty" | "saving" } | { status: "error"; message: string };

export interface CampaignSaveBarProps {
  state: DetailsSaveState;
  onSave: () => void;
}

/**
 * The one place the author sees whether Details and Targeting are saved: they save by
 * themselves a moment after the last edit (and on leaving the tab), and this button saves
 * at once. Nothing here is a promise the page will not make: an error says what went wrong.
 */
export function CampaignSaveBar({ state, onSave }: CampaignSaveBarProps) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={state.status === "saving" || state.status === "saved"}
        loading={state.status === "saving"}
        onClick={onSave}
      >
        {t("campaignBuilder.save.button")}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-xs font-sans text-danger">
          {state.message}
        </p>
      ) : (
        <p role="status" className="text-xs font-sans text-fg-muted">
          {t(`campaignBuilder.save.${state.status}`)}
        </p>
      )}
    </div>
  );
}
