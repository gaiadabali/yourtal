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

export interface ResumePromptProps {
  positionSeconds: number;
  onChoose: (choice: "resume" | "restart") => void;
}

/** Shown when a prior watch position exists (localStorage, resume-position.ts). Offers resume vs. start over — never auto-resumes. */
export function ResumePrompt({ positionSeconds, onChoose }: ResumePromptProps) {
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
          <DialogTitle>Continue watching?</DialogTitle>
          <DialogDescription>
            You watched up to {formatClock(positionSeconds)} last time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onChoose("restart")}>
            Start over
          </Button>
          <Button type="button" onClick={() => onChoose("resume")}>
            Resume from {formatClock(positionSeconds)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
