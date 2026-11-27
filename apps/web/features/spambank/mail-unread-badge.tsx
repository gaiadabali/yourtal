"use client";

import { MailProvider, useUnreadCount } from "@yourtal/mail-engine/react";
import { sharedMailClient } from "./mail-client";
import { countLabel } from "./mail-format";
import { cn } from "@yourtal/ui/cn";

function Count({ label, className }: { label: (count: number) => string; className: string }) {
  const count = useUnreadCount("inbox");
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="mail-unread-badge"
        className={cn(
          "inline-flex min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-caption font-sans font-bold tabular-nums text-fg-on-accent",
          className,
        )}
      >
        {countLabel(count)}
      </span>
      <span className="sr-only">{label(count)}</span>
    </>
  );
}

/**
 * The live unread count of the Inbox, on the tab's shared client. Loaded on its own after the page
 * (`mail-nav-link.tsx`), so the mail engine is not part of any page's first load.
 */
export default function MailUnreadBadge({
  label,
  className,
}: {
  label: (count: number) => string;
  className: string;
}) {
  return (
    <MailProvider client={sharedMailClient()}>
      <Count label={label} className={className} />
    </MailProvider>
  );
}
