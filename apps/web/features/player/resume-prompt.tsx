"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { Button } from "@yourtal/ui/button";
import { formatClock } from "./format-clock";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface ResumePromptProps {
  positionSeconds: number;
  onChoose: (choice: "resume" | "restart") => void;
  locale: SupportedLocale;
}

/** Shown when a prior watch position exists (localStorage, resume-position.ts). Offers resume vs. start over — never auto-resumes. */
export function ResumePrompt({ positionSeconds, onChoose, locale }: ResumePromptProps) {
  const t = getPlayerTranslator(locale);
  const time = formatClock(positionSeconds);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Dismissing without an explicit choice (Escape, the × control)
        // defaults to "restart" rather than silently resuming.
        if (!open) {
          onChoose("restart");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("resume.title")}</DialogTitle>
          <DialogDescription>{t("resume.description", { time })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onChoose("restart")}>
            {t("resume.startOver")}
          </Button>
          <Button type="button" onClick={() => onChoose("resume")}>
            {t("resume.resumeFrom", { time })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
