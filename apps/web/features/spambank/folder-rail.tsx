"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, FileText, Folder as FolderIcon, Inbox, Send, Settings, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Folder, FolderKey } from "@yourtal/mail-engine";
import { useFolders } from "@yourtal/mail-engine/react";
import { cn } from "@yourtal/ui/cn";
import { countLabel } from "./mail-format";
import { FOLDER_ORDER, MAIL_SETTINGS_HREF, folderHref } from "./mail-routes";
import { useMailBase } from "./mail-root";

const FOLDER_ICON: Record<FolderKey, LucideIcon> = {
  inbox: Inbox,
  spam: Ban,
  junk: FolderIcon,
  sent: Send,
  drafts: FileText,
  trash: Trash2,
};

/** Unread for the folders you read; the total for Drafts; nothing for Sent and Trash. */
export function folderCount(folder: Folder | undefined): number {
  if (!folder) return 0;
  if (folder.key === "inbox" || folder.key === "spam" || folder.key === "junk")
    return folder.unread;
  if (folder.key === "drafts") return folder.total;
  return 0;
}

/** Which folder the URL is in; `null` on a message, compose or search page. */
export function activeFolder(pathname: string, base: string): FolderKey | null {
  if (pathname === base || pathname === `${base}/`) return "inbox";
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : "";
  return (FOLDER_ORDER as readonly string[]).includes(rest) ? (rest as FolderKey) : null;
}

const ITEM =
  "flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-body-sm font-sans transition-colors duration-(--duration-fast) ease-standard";
const ITEM_ON = "bg-accent-subtle font-semibold text-fg";
const ITEM_OFF = "font-medium text-fg-muted hover:bg-surface-sunken hover:text-fg";

/** The folder list: a row of chips on a phone, a column from `md`. No state of its own. */
export function FolderRailView({
  base,
  folders,
  active,
}: {
  base: string;
  folders: Folder[];
  active: FolderKey | null;
}) {
  const t = useTranslations("spambank");
  return (
    <nav
      aria-label={t("shell.foldersNav")}
      className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
    >
      {FOLDER_ORDER.map((key) => {
        const count = folderCount(folders.find((f) => f.key === key));
        const current = active === key;
        const Icon = FOLDER_ICON[key];
        return (
          <Link
            key={key}
            href={folderHref(base, key)}
            aria-current={current ? "page" : undefined}
            className={cn(ITEM, current ? ITEM_ON : ITEM_OFF)}
          >
            <Icon aria-hidden="true" className="size-[18px]" />
            <span>{t(`folders.${key}`)}</span>
            {count > 0 ? (
              <span
                className={cn(
                  "ml-auto rounded-pill px-1.5 py-px text-caption font-sans tabular-nums",
                  key === "drafts" ? "text-fg-muted" : "bg-accent text-fg-on-accent",
                )}
              >
                <span aria-hidden="true">{countLabel(count)}</span>
                <span className="sr-only">
                  {" "}
                  {key === "drafts"
                    ? t("shell.draftsCount", { count })
                    : t("shell.unreadCount", { count })}
                </span>
              </span>
            ) : null}
          </Link>
        );
      })}
      <span aria-hidden="true" className="mx-2 my-1 hidden h-px bg-border-subtle md:block" />
      <Link href={MAIL_SETTINGS_HREF} className={cn(ITEM, ITEM_OFF)}>
        <Settings aria-hidden="true" className="size-[18px]" />
        <span>{t("shell.settings")}</span>
      </Link>
    </nav>
  );
}

export function FolderRail() {
  const base = useMailBase();
  const pathname = usePathname();
  const { folders } = useFolders();
  return <FolderRailView base={base} folders={folders} active={activeFolder(pathname, base)} />;
}
