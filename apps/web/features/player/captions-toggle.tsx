"use client";

import { Captions, CaptionsOff } from "lucide-react";
import { Button } from "@yourtal/ui/button";
import { cn } from "@yourtal/ui/cn";

export interface CaptionsToggleProps {
  on: boolean;
  onToggle: () => void;
  /** "Captions": the pressed state says whether they are showing. */
  label: string;
  className?: string;
}

/** 13.9.e: the CC button over a player. A pressed button means captions are showing. */
export function CaptionsToggle({ on, onToggle, label, className }: CaptionsToggleProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
      className={cn("absolute right-2 top-2 z-10", on && "ring-2 ring-accent", className)}
    >
      {on ? (
        <Captions aria-hidden="true" className="size-4" />
      ) : (
        <CaptionsOff aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}
