"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface BusinessConsoleErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the business console (YT-0440). Next.js requires this
 * exact filename and a `"use client"` default export receiving
 * `{ error, reset }` — mirrors `store/error.tsx`. Fires for real today when
 * `YOURTAL_DATA_SOURCE=live` is set, since no BFF exists yet
 * (`console-data.ts`'s live data source always rejects).
 */
export default function BusinessConsoleError({ error, reset }: BusinessConsoleErrorProps) {
  useEffect(() => {
    console.error("Business console failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-fg">Business console</h1>
      <p className="text-sm font-sans text-fg-muted">
        Something went wrong loading this business. Check your connection and try again.
      </p>
      <Button type="button" onClick={reset} className="w-fit">
        Retry
      </Button>
    </div>
  );
}
