"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@yourtal/ui/button";

/**
 * A form's submit button that is disabled while its server action runs, so a
 * double tap cannot send the form twice (a second register then hits "email
 * taken" and shows the generic error over an account that was just created).
 */
export function PendingSubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {children}
    </Button>
  );
}
