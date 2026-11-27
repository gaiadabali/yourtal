import "server-only";

import { cache } from "react";
import { mailboxStatusSchema } from "@yourtal/contracts/spambank/management";
import type { MailboxStatus } from "@yourtal/contracts/spambank/management";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * `GET /api/spambank/me`: whether this person has a mailbox and in what state. An adult sees `off`,
 * `on` or `suspended`; a teen sees `not_allowed` (the screens answer 404 and the nav hides Mail);
 * `available: false` means the feature is switched off. A 401 means no session.
 */
export const getMailboxStatus = cache((): Promise<ApiResult<MailboxStatus>> =>
  apiFetch("/api/spambank/me", mailboxStatusSchema),
);

/** What the shell shows: the Mail entry, and whether the unread badge may run. */
export type MailNavState = { readonly on: boolean } | null;

/** `null` hides Mail (feature off, a teen, a failed read); `on` also starts the live badge. */
export function mailNavState(status: ApiResult<MailboxStatus>): MailNavState {
  if (!status.ok || !status.data.available) return null;
  const { state } = status.data;
  if (state === "on") return { on: true };
  if (state === "off" || state === "suspended") return { on: false };
  return null;
}
