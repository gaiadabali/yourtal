"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Button } from "@yourtal/ui/button";
import { Badge } from "@yourtal/ui/badge";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ListRow } from "@yourtal/ui/list-row";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@yourtal/ui/sheet";
import type { Notification } from "@yourtal/contracts/me/notification";
import { notificationCopy } from "./notification-copy";
import { markNotificationReadAction } from "./notifications-actions";

export interface NotificationsBellProps {
  /** Server-fetched at shell render time (`app-shell.tsx`) — the bell never fetches on mount. */
  initialNotifications: readonly Notification[];
}

/**
 * 11.7.a: a bell in the top bar over 5.5.b's `GET /api/me/notifications` /
 * `PATCH .../:id/read`. A `Sheet` (side="right") rather than a bespoke
 * anchored popover — `packages/ui` has no popover primitive yet, and a
 * slide-over is the same "list of things that happened" pattern the wallet
 * and store already use.
 *
 * State starts from the server-fetched list and only ever moves forward
 * (an item marked read locally, optimistically, on top of the real
 * `PATCH` call) — never re-fetched on open, so a viewer who dismisses
 * everything and reopens the sheet in the same page load sees exactly what
 * they last saw, not a network round trip.
 */
export function NotificationsBell({ initialNotifications }: NotificationsBellProps) {
  const t = useTranslations("shell.notifications");
  const format = useFormatter();
  const copyTools = {
    voucherExpiringTitle: t("voucherExpiringTitle"),
    voucherExpiringBody: (reward: string, date: Date) =>
      t("voucherExpiringBody", {
        reward,
        date: format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" }),
      }),
  };
  const [notifications, setNotifications] = useState<readonly Notification[]>(initialNotifications);
  const [, startTransition] = useTransition();
  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  function markRead(id: number) {
    // Optimistic: the row loses its unread state immediately; a failed
    // PATCH leaves it looking read locally for the rest of this page view,
    // which is the same trade `me-actions.ts`'s callers already accept for
    // a non-money toggle — a retried read receipt is not worth an error banner.
    setNotifications((current) =>
      current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    startTransition(() => {
      void markNotificationReadAction(id);
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? t("unreadCount", { count: unreadCount }) : t("bellLabel")}
          className="relative shrink-0"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 ? (
            <Badge
              variant="danger"
              className="absolute -right-1 -top-1 min-w-4 justify-center px-1 py-0 text-caption leading-4"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-4 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        {notifications.length === 0 ? (
          <EmptyState title={t("empty")} />
        ) : (
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {notifications.map((notification) => {
              const copy = notificationCopy(notification, copyTools);
              return (
                <li key={notification.id}>
                  <ListRow
                    title={copy.title}
                    subtitle={copy.body}
                    onClick={() => {
                      if (notification.readAt === null) markRead(notification.id);
                    }}
                    trailing={
                      notification.readAt === null ? (
                        <span
                          aria-label={t("markRead")}
                          className="block size-2 shrink-0 rounded-full bg-accent"
                        />
                      ) : null
                    }
                    {...(notification.readAt === null ? { className: "bg-surface-sunken" } : {})}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
