"use client";

import dynamic from "next/dynamic";
import type { MailboxQuota } from "@yourtal/contracts/spambank/management";
import { Skeleton } from "@yourtal/ui/skeleton";

/**
 * Mail settings on Me load after the page: `/me` is already close to its first-load budget, and
 * this section (app passwords, the delete dialog) is only used by people who have switched mail on.
 * The skeleton holds the section's place so nothing below it jumps.
 */
const Section = dynamic(() => import("./me-mail-section").then((m) => m.MeMailSection), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-card" />,
});

export function LazyMeMailSection(props: {
  address: string | null;
  quota?: MailboxQuota | undefined;
}) {
  return <Section {...props} />;
}
